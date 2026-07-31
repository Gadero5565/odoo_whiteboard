/** @odoo-module **/

import { Component, onMounted, onWillStart, onWillUnmount, useRef, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { useSetupAction } from "@web/webclient/actions/action_hook";

import {
    WHITEBOARD_OBJECT_PROPS,
    createWhiteboardShape,
    createWhiteboardArrow,
    createWhiteboardMindNode,
    createWhiteboardConnector,
    createWhiteboardFlowNode,
} from "./whiteboard_objects";

import {
    WHITEBOARD_TEMPLATES,
    buildWhiteboardTemplate,
} from "./whiteboard_templates";

const AUTOSAVE_DEBOUNCE_MS = 1500;
const AUTOSAVE_RETRY_MS = 10000;

const HISTORY_MAX_ENTRIES = 50;
const HISTORY_MAX_TOTAL_BYTES = 12 * 1024 * 1024;

const BOARD_LIST_PAGE_SIZE = 25;

const THUMBNAIL_MULTIPLIER = 0.18;
const THUMBNAIL_JPEG_QUALITY = 0.72;

const CANVAS_MAX_OBJECTS = 800;
const CANVAS_MAX_JSON_BYTES = 1.5 * 1024 * 1024;
const CANVAS_WARNING_RATIO = 0.75;

const LARGE_BOARD_OBJECT_THRESHOLD = 250;
const LARGE_BOARD_JSON_BYTES = 384 * 1024;

export class WhiteboardAction extends Component {
    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");

        this.canvasRef = useRef("canvas");
        this.wrapRef = useRef("wrap");

        const rawBoardId = this.props.action?.params?.board_id;
        const parsedBoardId = rawBoardId ? parseInt(rawBoardId, 10) : null;

        this.initialBoardId = Number.isFinite(parsedBoardId) ? parsedBoardId : null;

        this.state = useState({
            loading: true,
            loadingMessage: "Loading whiteboard…",
            fatalError: "",
            saving: false,

            boardId: this.initialBoardId,
            boardName: "My Whiteboard",
            boardRevision: null,
            dirty: false,
            canUndo: false,
            canRedo: false,

            saveStatus: "saved",
            saveStatusText: "Saved",

            canvasObjectCount: 0,
            canvasJsonBytes: 0,
            canvasUsageText: "",
            canvasLimitWarning: false,
            canvasLimitExceeded: false,

            sidebarOpen: false,

            color: "#111111",
            width: 4,
            mode: "pen",
            connectorFromNodeId: null,

            templates: WHITEBOARD_TEMPLATES,

            boards: [],
            boardsLoading: false,
            boardsHasMore: false,
            boardsNextOffset: 0,
        });

        this._canvasDirty = false;
        this._nameDirty = false;
        this._savedBoardName = "My Whiteboard";

        this._canvasChangeVersion = 0;
        this._nameChangeVersion = 0;

        this._autosaveTimer = null;
        this._autosaveBlockedReason = null;
        this._autosaveFailureNotified = false;
        this._thumbnailFailureNotified = false;
        this.undoStack = [];
        this.redoStack = [];

        this._historyEncoder = (
            typeof TextEncoder !== "undefined"
                ? new TextEncoder()
                : null
        );

        this._isApplyingHistory = false;
        this._historyTimer = null;
        this._limitRollbackInProgress = false;

        this._eraserPointerDown = false;
        this._eraserChanged = false;
        this._eraserRemovedObjects = new Set();

        this._resizeCanvas = this._resizeCanvas.bind(this);

        this._beforeUnload = (ev) => {
            if (!this.state.dirty) {
                return;
            }

            ev.preventDefault();
            ev.returnValue = "";
            return "";
        };

        this._beforeLeave = () => {
            if (this.state.saving) {
                this.notification.add(
                    "A whiteboard save is still in progress.",
                    { type: "warning" }
                );
                return false;
            }

            if (!this.state.dirty) {
                return true;
            }

            return window.confirm(
                "You have unsaved whiteboard changes. Leave this page and discard them?"
            );
        };

        useSetupAction({
            beforeUnload: this._beforeUnload,
            beforeLeave: this._beforeLeave,
        });

        this._handleKeyDown = (ev) => {
            if (
                this.state.loading
                || this._isKeyboardEditingTarget(ev.target)
                || this._isCanvasTextEditing()
            ) {
                return;
            }

            const key = String(
                ev.key || ""
            ).toLowerCase();

            const primaryModifier = (
                ev.ctrlKey
                || ev.metaKey
            );

            /*
             * Ctrl/Cmd + S
             */
            if (
                primaryModifier
                && !ev.altKey
                && key === "s"
            ) {
                ev.preventDefault();

                if (
                    this.state.dirty
                    && !this.state.saving
                ) {
                    void this.save();
                }

                return;
            }

            /*
             * Ctrl/Cmd + Z
             * Ctrl/Cmd + Shift + Z
             */
            if (
                primaryModifier
                && !ev.altKey
                && key === "z"
            ) {
                ev.preventDefault();

                if (ev.shiftKey) {
                    this.redo();
                } else {
                    this.undo();
                }

                return;
            }

            /*
             * Ctrl/Cmd + Y
             */
            if (
                primaryModifier
                && !ev.altKey
                && key === "y"
            ) {
                ev.preventDefault();
                this.redo();
                return;
            }

            /*
             * Escape:
             * 1. Leave a drawing/connector/eraser mode.
             * 2. Clear the current selection.
             * 3. Close the tools panel.
             */
            if (key === "escape") {
                const activeObject = (
                    this.canvas?.getActiveObject()
                );

                if (
                    this.state.mode !== "select"
                    || this.state.connectorFromNodeId
                ) {
                    ev.preventDefault();
                    this.setSelect();
                    return;
                }

                if (activeObject) {
                    ev.preventDefault();

                    this.canvas.discardActiveObject();
                    this.canvas.requestRenderAll();

                    return;
                }

                if (this.state.sidebarOpen) {
                    ev.preventDefault();
                    this.closeSidebar();
                }

                return;
            }

            /*
             * Delete or Backspace removes selected objects.
             */
            if (
                key === "delete"
                || key === "backspace"
            ) {
                const activeObject = (
                    this.canvas?.getActiveObject()
                );

                if (!activeObject) {
                    return;
                }

                ev.preventDefault();
                this.deleteSelectedObjects();
            }
        };

        onWillStart(async () => {
            await this._loadBoardsList();
        });

        onMounted(async () => {
            try {
                const ready = await this._initFabric();

                if (!ready) {
                    return;
                }

                const loaded = await this._loadBoardFromServer(
                    this.initialBoardId
                );

                if (!loaded) {
                    this.state.fatalError = (
                        "The whiteboard could not be loaded. "
                        + "Reload the page and try again."
                    );

                    return;
                }

                this._resizeCanvas();

                window.addEventListener(
                    "resize",
                    this._resizeCanvas
                );

                window.addEventListener(
                    "keydown",
                    this._handleKeyDown
                );
            } catch {
                this.state.fatalError = (
                    "The whiteboard could not be initialized. "
                    + "Reload the page and try again."
                );

                this.notification.add(
                    "Could not initialize whiteboard.",
                    {
                        type: "danger",
                    }
                );
            } finally {
                this.state.loading = false;
            }
        });

        onWillUnmount(() => {
            window.removeEventListener("resize", this._resizeCanvas);
            window.removeEventListener("keydown", this._handleKeyDown);

            this._cancelAutosave();

            if (this._historyTimer) {
                clearTimeout(this._historyTimer);
                this._historyTimer = null;
            }

            if (this.canvas) {
                this.canvas.dispose();
            }
        });
    }

    _isKeyboardEditingTarget(target) {
        if (!target) {
            return false;
        }

        const tagName = (
            target.tagName
            ?.toLowerCase()
        );

        if (
            ["input", "textarea", "select"]
                .includes(tagName)
        ) {
            return true;
        }

        if (target.isContentEditable) {
            return true;
        }

        if (
            typeof target.closest === "function"
            && target.closest(
                '[contenteditable="true"]'
            )
        ) {
            return true;
        }

        return false;
    }

    _isCanvasTextEditing() {
        const activeObject = (
            this.canvas?.getActiveObject()
        );

        return Boolean(
            activeObject?.isEditing
        );
    }

    _syncHistoryAvailability() {
        this.state.canUndo = (
            this.undoStack.length > 1
        );

        this.state.canRedo = (
            this.redoStack.length > 0
        );
    }

    // -------------------------------------------------------------------------
    // Fabric init
    // -------------------------------------------------------------------------

    async _initFabric() {
        const fabric = window.fabric;

        if (!fabric) {
            this.state.fatalError = (
                "The whiteboard library could not be loaded. "
                + "Verify the bundled Fabric.js asset and rebuild Odoo assets."
            );

            this.notification.add(
                (
                    "Fabric.js is not loaded. Verify "
                    + "static/src/lib/fabric.min.js."
                ),
                {
                    type: "danger",
                }
            );
            return false;
        }

        const canvasEl = this.canvasRef.el;

        this.canvas = new fabric.Canvas(canvasEl, {
            backgroundColor: "white",
            preserveObjectStacking: true,
            selection: true,
            enablePointerEvents: true,
        });

        const upper = this.canvas.upperCanvasEl;
        upper.style.touchAction = "none";

        upper.addEventListener("pointerdown", (ev) => {
            try {
                upper.setPointerCapture(ev.pointerId);
            } catch {
                // ignored
            }
        });

        upper.addEventListener("pointerup", (ev) => {
            try {
                upper.releasePointerCapture(ev.pointerId);
            } catch {
                // ignored
            }
        });

        upper.addEventListener("pointercancel", (ev) => {
            try {
                upper.releasePointerCapture(ev.pointerId);
            } catch {
                // ignored
            }

            this._finishEraserStroke();
        });

        this.canvas.isDrawingMode = true;
        this._applyBrush();

        /*
         * History strategy:
         * - do not listen to object:added globally because it duplicates path/text pushes
         * - path:created handles drawing
         * - object:modified handles move/resize/rotate
         * - object:removed handles object deletion
         * - text:changed is debounced so typing does not create a huge history stack
         */
        this.canvas.on("path:created", (ev) => {
            const path = ev.path || ev.target;

            this._pushHistory(true, {
                rollbackObjects: path ? [path] : [],
            });
        });

        this.canvas.on("object:moving", (ev) => {
            this._updateConnectorsForObject(ev.target);
        });

        this.canvas.on("object:scaling", (ev) => {
            this._updateConnectorsForObject(ev.target);
        });

        this.canvas.on("object:rotating", (ev) => {
            this._updateConnectorsForObject(ev.target);
        });

        this.canvas.on("object:modified", (ev) => {
            this._updateConnectorsForObject(ev.target);
            this._pushHistory();
        });

        this.canvas.on("object:removed", () => this._pushHistory());
        this.canvas.on("text:changed", () => this._pushHistoryDebounced());

        this.canvas.on("mouse:dblclick", (ev) => {
            if (this.state.mode === "eraser") {
                return;
            }

            this._editNodeFromTarget(ev.target);
        });

        this.canvas.on("mouse:down", (ev) => {
            if (this.state.mode === "eraser") {
                this._startEraserStroke(ev);
                return;
            }

            this._handleConnectorMouseDown(ev);
        });

        this.canvas.on("mouse:move", (ev) => {
            this._continueEraserStroke(ev);
        });

        this.canvas.on("mouse:up", () => {
            this._finishEraserStroke();
        });

        this._resetHistoryFromCanvas();

        return true;
    }

    _resizeCanvas() {
        if (!this.canvas || !this.wrapRef.el) return;

        const rect = this.wrapRef.el.getBoundingClientRect();
        const style = window.getComputedStyle(this.wrapRef.el);

        const paddingX =
            parseFloat(style.paddingLeft || "0") +
            parseFloat(style.paddingRight || "0");

        const paddingY =
            parseFloat(style.paddingTop || "0") +
            parseFloat(style.paddingBottom || "0");

        const width = Math.max(300, Math.floor(rect.width - paddingX));
        const height = Math.max(300, Math.floor(rect.height - paddingY));

        this.canvas.setDimensions({ width, height });
        this.canvas.calcOffset();
        this.canvas.requestRenderAll();
    }

    _applyBrush() {
        const fabric = window.fabric;
        if (!this.canvas || !fabric) return;

        const brush = new fabric.PencilBrush(
            this.canvas
        );

        brush.width = (
            Number(this.state.width)
            || 4
        );

        brush.color = this.state.color;

        this.canvas.freeDrawingBrush = brush;
    }

    // -------------------------------------------------------------------------
    // SideBar
    // -------------------------------------------------------------------------

    toggleSidebar() {
        this.state.sidebarOpen = !this.state.sidebarOpen;
        this._resizeCanvasAfterSidebarAnimation();
    }

    openSidebar() {
        this.state.sidebarOpen = true;
        this._resizeCanvasAfterSidebarAnimation();
    }

    closeSidebar() {
        this.state.sidebarOpen = false;
        this._resizeCanvasAfterSidebarAnimation();
    }

    _resizeCanvasAfterSidebarAnimation() {
        if (!this.canvas) {
            return;
        }

        requestAnimationFrame(() => this._resizeCanvas());

        window.setTimeout(() => {
            this._resizeCanvas();
        }, 260);
    }

    /* -------------------------------------------------------------------------
     * Templates
     * ------------------------------------------------------------------------- */

    insertTemplate(templateCode) {
        const fabric = window.fabric;

        if (!fabric || !this.canvas) {
            return;
        }

        this.setSelect();

        const point = this._getInsertPoint();

        const result = buildWhiteboardTemplate(fabric, templateCode, {
            centerX: point.x,
            centerY: point.y,
            color: this.state.color,
        });

        if (!result || !result.objects?.length) {
            this.notification.add("Template could not be inserted.", {
                type: "warning",
            });
            return;
        }

        this._runWithoutHistory(() => {
            for (const object of result.objects) {
                this.canvas.add(object);
            }

            for (const connector of result.connectors || []) {
                this.canvas.sendToBack(connector);
            }
        });

        if (result.activeObject) {
            this.canvas.setActiveObject(result.activeObject);
        }

        this._updateAllConnectors();
        this.canvas.requestRenderAll();

        const accepted = this._pushHistory(true, {
            rollbackObjects: [...result.objects],
        });

        if (!accepted) {
            return;
        }

        const template = this.state.templates.find((item) => item.code === templateCode);
        const templateName = template?.name || "Template";

        this.notification.add(`${templateName} template inserted.`, {
            type: "success",
        });
    }

    insertMindMapTemplate() {
        this.insertTemplate("mind_map");
    }

    insertProjectPlanTemplate() {
        this.insertTemplate("project_plan");
    }

    insertBasicFlowchartTemplate() {
        this.insertTemplate("basic_flowchart");
    }

    insertProjectWorkflowTemplate() {
        this.insertTemplate("project_workflow");
    }

    _setSaveStatus(status, text = null) {
        const defaultMessages = {
            saved: "Saved",
            unsaved: "Unsaved changes",
            saving: "Saving…",
            error: "Save failed",
        };

        this.state.saveStatus = status;

        this.state.saveStatusText = (
            text
            || defaultMessages[status]
            || "Saved"
        );
    }

    // -------------------------------------------------------------------------
    // Dirty-state and autosave helpers
    // -------------------------------------------------------------------------

    _syncDirtyState() {
        this.state.dirty = (
            this._canvasDirty
            || this._nameDirty
        );

        if (!this.state.dirty) {
            this._cancelAutosave();

            if (
                !this.state.saving
                && this.state.boardId
            ) {
                this._setSaveStatus("saved");
            }

            return;
        }

        /*
         * Preserve "Save failed" until the user makes another edit or
         * retries the save.
         */
        if (
            !this.state.saving
            && this.state.saveStatus !== "error"
        ) {
            this._setSaveStatus("unsaved");
        }
    }

    _clearRecoverableAutosaveBlock() {
        if (this._autosaveBlockedReason === "validation") {
            this._autosaveBlockedReason = null;
        }
    }

    _markCanvasDirty() {
        this._canvasDirty = true;
        this._canvasChangeVersion += 1;

        this._clearRecoverableAutosaveBlock();
        this._syncDirtyState();
        this._setSaveStatus("unsaved");
        this._scheduleAutosave();
    }

    _resetDirtyState(savedBoardName = null) {
        if (savedBoardName !== null) {
            this._savedBoardName = savedBoardName;
        }

        this._canvasDirty = false;
        this._nameDirty = false;

        this._canvasChangeVersion = 0;
        this._nameChangeVersion = 0;

        this._autosaveBlockedReason = null;
        this._autosaveFailureNotified = false;

        this._cancelAutosave();
        this._syncDirtyState();

        if (this.state.boardId) {
            this._setSaveStatus("saved");
        }
    }

    onBoardNameInput(ev) {
        const nextName = ev.target.value;
        const previousName = this.state.boardName;

        this.state.boardName = nextName;

        if (nextName !== previousName) {
            this._nameChangeVersion += 1;
            this._clearRecoverableAutosaveBlock();
        }

        this._nameDirty = (
            nextName
            !== this._savedBoardName
        );

        this._syncDirtyState();

        if (this.state.dirty) {
            this._setSaveStatus("unsaved");
            this._scheduleAutosave();
        }
    }

    _cancelAutosave() {
        if (!this._autosaveTimer) {
            return;
        }

        clearTimeout(this._autosaveTimer);
        this._autosaveTimer = null;
    }

    _scheduleAutosave(delay = AUTOSAVE_DEBOUNCE_MS) {
        this._cancelAutosave();

        if (
            !this.state.dirty
            || this.state.loading
            || this.state.saving
            || !this.state.boardId
            || this._autosaveBlockedReason
        ) {
            return;
        }

        this._autosaveTimer = window.setTimeout(() => {
            this._autosaveTimer = null;
            void this._runAutosave();
        }, delay);
    }

    async _runAutosave() {
        if (
            !this.state.dirty
            || this.state.loading
            || this.state.saving
            || !this.state.boardId
            || this._autosaveBlockedReason
        ) {
            return;
        }

        await this._saveBoard({ manual: false });
    }

    // -------------------------------------------------------------------------
    // Object/path eraser
    // -------------------------------------------------------------------------

    _startEraserStroke(ev) {
        if (
            !this.canvas
            || this.state.mode !== "eraser"
        ) {
            return;
        }

        this._eraserPointerDown = true;
        this._eraserChanged = false;
        this._eraserRemovedObjects.clear();

        this.canvas.discardActiveObject();

        this._eraseTargetFromEvent(ev);
    }

    _continueEraserStroke(ev) {
        if (
            !this.canvas
            || this.state.mode !== "eraser"
            || !this._eraserPointerDown
        ) {
            return;
        }

        this._eraseTargetFromEvent(ev);
    }

    _finishEraserStroke() {
        const changed = this._eraserChanged;

        this._eraserPointerDown = false;
        this._eraserChanged = false;
        this._eraserRemovedObjects.clear();

        if (
            changed
            && this.canvas
        ) {
            /*
             * All objects removed during one pointer gesture become one
             * undo/redo history operation.
             */
            this._pushHistory();
        }
    }

    _getEraserTargetFromEvent(ev) {
        if (!this.canvas) {
            return null;
        }

        let target = ev?.target || null;

        /*
         * Fabric does not always populate ev.target during a drag after
         * the object beneath the pointer has just been removed.
         */
        if (
            !target
            && ev?.e
            && typeof this.canvas.findTarget === "function"
        ) {
            try {
                target = this.canvas.findTarget(
                    ev.e,
                    false
                );
            } catch {
                target = null;
            }
        }

        return this._getTopLevelCanvasObject(
            target
        );
    }

    _getTopLevelCanvasObject(target) {
        if (
            !target
            || !this.canvas
        ) {
            return null;
        }

        let object = target;

        /*
         * A click may target text or a shape inside a Fabric group.
         * The eraser removes the complete whiteboard node/group.
         */
        while (
            object.group
            && object.group.type !== "activeSelection"
        ) {
            object = object.group;
        }

        if (
            object.type === "activeSelection"
        ) {
            return null;
        }

        if (
            !this.canvas
                .getObjects()
                .includes(object)
        ) {
            return null;
        }

        return object;
    }

    _eraseTargetFromEvent(ev) {
        if (!this.canvas) {
            return false;
        }

        const target = (
            this._getEraserTargetFromEvent(ev)
        );

        if (
            !target
            || this._eraserRemovedObjects.has(target)
        ) {
            return false;
        }

        const objectsToRemove = (
            this._getObjectsToRemoveWithConnectors(
                [target]
            )
        ).filter((object) => {
            return this.canvas
                .getObjects()
                .includes(object);
        });

        if (!objectsToRemove.length) {
            return false;
        }

        this._runWithoutHistory(() => {
            this.canvas.discardActiveObject();

            for (const object of objectsToRemove) {
                this._eraserRemovedObjects.add(
                    object
                );

                this.canvas.remove(object);
            }
        });

        this.state.connectorFromNodeId = null;
        this._eraserChanged = true;

        this.canvas.requestRenderAll();

        return true;
    }

    // -------------------------------------------------------------------------
    // UI handlers
    // -------------------------------------------------------------------------

    setColor(ev) {
        this.state.color = ev.target.value;
        if (this.state.mode === "pen") {
            this._applyBrush();
        }
    }

    setWidth(ev) {
        this.state.width = parseInt(
            ev.target.value || "4",
            10
        );

        if (this.state.mode === "pen") {
            this._applyBrush();
        }
    }

    setSelect() {
        if (!this.canvas) return;

        this._finishEraserStroke();

        this.state.mode = "select";
        this.state.connectorFromNodeId = null;

        this.canvas.isDrawingMode = false;
        this.canvas.selection = true;
        this.canvas.skipTargetFind = false;

        this.canvas.defaultCursor = "default";
        this.canvas.hoverCursor = "move";

        this.canvas.requestRenderAll();
    }

    setPen() {
        if (!this.canvas) return;

        this._finishEraserStroke();

        this.state.mode = "pen";
        this.state.connectorFromNodeId = null;

        this.canvas.discardActiveObject();
        this.canvas.selection = false;
        this.canvas.skipTargetFind = true;
        this.canvas.isDrawingMode = true;

        this.canvas.defaultCursor = "crosshair";
        this.canvas.hoverCursor = "crosshair";

        this._applyBrush();
        this.canvas.requestRenderAll();
    }

    setEraser() {
        if (!this.canvas) return;

        this._finishEraserStroke();

        this.state.mode = "eraser";
        this.state.connectorFromNodeId = null;

        /*
         * The eraser performs object hit-testing instead of drawing a
         * white path.
         */
        this.canvas.isDrawingMode = false;
        this.canvas.selection = false;
        this.canvas.skipTargetFind = false;

        this.canvas.discardActiveObject();

        this.canvas.defaultCursor = "crosshair";
        this.canvas.hoverCursor = "crosshair";

        this.canvas.requestRenderAll();
    }

    setConnectorMode() {
        if (!this.canvas) return;
        this._finishEraserStroke();
        this.state.mode = "connector";
        this.state.connectorFromNodeId = null;
        this.canvas.isDrawingMode = false;
        this.canvas.selection = false;
        this.canvas.skipTargetFind = false;
        this.canvas.discardActiveObject();
        this.canvas.defaultCursor = "crosshair";
        this.canvas.hoverCursor = "crosshair";
        this.canvas.requestRenderAll();
        this.notification.add("Connector mode: click a source object, then a target object.", {
            type: "info",
        });
    }

    addText() {
        const fabric = window.fabric;
        if (!fabric || !this.canvas) return;
        this._finishEraserStroke();

        this.state.mode = "text";
        this.state.connectorFromNodeId = null;

        this.canvas.isDrawingMode = false;
        this.canvas.selection = true;
        this.canvas.skipTargetFind = false;
        this.canvas.defaultCursor = "text";

        const point = this._getInsertPoint();

        const text = new fabric.IText("Type here", {
            left: point.x,
            top: point.y,
            originX: "center",
            originY: "center",
            fontSize: 28,
            fill: this.state.color,
        });

        text.on("editing:exited", () => {
            if (this.state.mode === "text") {
                this.setSelect();
            }
        });

        this.canvas.add(text);
        this.canvas.setActiveObject(text);
        this.canvas.requestRenderAll();

        const accepted = this._pushHistory(true, {
            rollbackObjects: [text],
        });

        if (!accepted) {
            return;
        }

        text.enterEditing();
        text.selectAll();
    }

    clearCanvas() {
        if (!this.canvas) return;

        const confirmed = window.confirm("Clear this whiteboard?");
        if (!confirmed) return;

        this._runWithoutHistory(() => {
            this._clearCanvasObjects();
        });

        this._pushHistory();
    }

    undo() {
        if (
            !this.canvas
            || this._isApplyingHistory
        ) {
            return;
        }

        this._flushDebouncedHistory();

        if (this.undoStack.length <= 1) {
            this._syncHistoryAvailability();
            return;
        }

        const current = this.undoStack.pop();

        this.redoStack.push(
            current
        );

        const previous = (
            this.undoStack[
                this.undoStack.length - 1
            ]
        );

        this._syncHistoryAvailability();

        void this._applyJSON(
            previous.json
        ).then((ok) => {
            if (ok) {
                this._updateCanvasUsage(
                    this._getPreviousHistoryStats(
                        previous
                    )
                );

                this._markCanvasDirty();
                this._syncHistoryAvailability();

                return;
            }

            /*
             * Restore the history stacks if Fabric could not apply the
             * previous state.
             */
            this.redoStack.pop();
            this.undoStack.push(
                current
            );

            this._syncHistoryAvailability();

            this.notification.add(
                "Could not undo the last action.",
                {
                    type: "danger",
                }
            );
        });
    }

    redo() {
        if (
            !this.canvas
            || this._isApplyingHistory
        ) {
            return;
        }

        this._flushDebouncedHistory();

        if (!this.redoStack.length) {
            this._syncHistoryAvailability();
            return;
        }

        const next = this.redoStack.pop();

        this.undoStack.push(
            next
        );

        this._syncHistoryAvailability();

        void this._applyJSON(
            next.json
        ).then((ok) => {
            if (ok) {
                this._updateCanvasUsage(
                    this._getPreviousHistoryStats(
                        next
                    )
                );

                this._markCanvasDirty();
                this._syncHistoryAvailability();

                return;
            }

            /*
             * Restore the history stacks if Fabric could not apply the
             * redo state.
             */
            this.undoStack.pop();
            this.redoStack.push(
                next
            );

            this._syncHistoryAvailability();

            this.notification.add(
                "Could not redo the last action.",
                {
                    type: "danger",
                }
            );
        });
    }

    exportPNG() {
        if (!this.canvas) {
            return;
        }

        try {
            const url = this.canvas.toDataURL({
                format: "png",
            });

            if (
                typeof url !== "string"
                || !url.startsWith(
                    "data:image/png"
                )
            ) {
                throw new Error(
                    "Invalid PNG data URL"
                );
            }

            const safeName = (
                this.state.boardName
                || "whiteboard"
            )
                .replace(
                    /[^\w\-]+/g,
                    "_"
                )
                .replace(
                    /^_+|_+$/g,
                    ""
                );

            const link = document.createElement(
                "a"
            );

            link.href = url;
            link.download = (
                `${safeName || "whiteboard"}.png`
            );

            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch {
            this.notification.add(
                (
                    "Could not export the whiteboard "
                    + "as a PNG image."
                ),
                {
                    type: "danger",
                }
            );
        }
    }

    async createBoard() {
        if (this.state.dirty) {
            const confirmed = window.confirm("You have unsaved changes. Create a new board and discard them?");
            if (!confirmed) return;
        }

        this.state.loading = true;

        try {
            const result = await this.orm.call(
                "whiteboard.board",
                "create_board",
                ["Untitled Board"]
            );

            if (result?.error) {
                this.notification.add(result.error, { type: "danger" });
                return;
            }

            const applied = await this._applyBoardPayload(
                result
            );

            await this._loadBoardsList();

            if (!applied) {
                this.notification.add(
                    (
                        "The board was created, but it "
                        + "could not be opened."
                    ),
                    {
                        type: "warning",
                    }
                );

                return;
            }

            this.notification.add(
                "New whiteboard created.",
                {
                    type: "success",
                }
            );
        } catch {
            this.notification.add("Could not create whiteboard.", { type: "danger" });
        } finally {
            this.state.loading = false;
        }
    }

    async onSelectBoard(ev) {
        const selectedBoardId = parseInt(
            ev.target.value,
            10
        );

        if (
            !selectedBoardId
            || selectedBoardId === this.state.boardId
        ) {
            return;
        }

        const previousBoardId = (
            this.state.boardId
        );

        if (this.state.dirty) {
            const confirmed = window.confirm(
                (
                    "You have unsaved changes. "
                    + "Switch boards and discard them?"
                )
            );

            if (!confirmed) {
                ev.target.value = (
                    previousBoardId
                        ? String(previousBoardId)
                        : ""
                );

                return;
            }
        }

        this.state.loading = true;

        try {
            const loaded = await this._loadBoardFromServer(
                selectedBoardId
            );

            if (!loaded) {
                ev.target.value = (
                    previousBoardId
                        ? String(previousBoardId)
                        : ""
                );
            }
        } finally {
            this.state.loading = false;
        }
    }

    _getInsertPoint() {
        if (!this.canvas) {
            return { x: 160, y: 120 };
        }

        const canvasWidth = this.canvas.getWidth();
        const canvasHeight = this.canvas.getHeight();

        const canvasEl = this.canvas.upperCanvasEl;
        const bodyEl = this.wrapRef.el?.parentElement;

        if (!canvasEl || !bodyEl) {
            return {
                x: canvasWidth / 2,
                y: canvasHeight / 2,
            };
        }

        const canvasRect = canvasEl.getBoundingClientRect();
        const bodyRect = bodyEl.getBoundingClientRect();

        const visibleCenterX = bodyRect.left + bodyRect.width / 2;
        const visibleCenterY = bodyRect.top + bodyRect.height / 2;

        const x = visibleCenterX - canvasRect.left;
        const y = visibleCenterY - canvasRect.top;

        return {
            x: Math.max(80, Math.min(canvasWidth - 80, x)),
            y: Math.max(80, Math.min(canvasHeight - 80, y)),
        };
    }

    _addShape(shape) {
        const fabric = window.fabric;

        if (!fabric || !this.canvas) {
            return;
        }

        this.setSelect();

        const point = this._getInsertPoint();

        const object = createWhiteboardShape(fabric, shape, {
            left: point.x,
            top: point.y,
            color: this.state.color,
            strokeWidth: this.state.width,
        });

        if (!object) {
            this.notification.add("Unsupported shape.", { type: "warning" });
            return;
        }

        this.canvas.add(object);
        this.canvas.setActiveObject(object);
        this.canvas.requestRenderAll();

        this._pushHistory(true, {
            rollbackObjects: [object],
        });
    }

    addRectangle() {
        this._addShape("rectangle");
    }

    addCircle() {
        this._addShape("circle");
    }

    addDiamond() {
        this._addShape("diamond");
    }

    addLine() {
        this._addShape("line");
    }

    /* -------------------------------------------------------------------------
     * Arrows
     * ------------------------------------------------------------------------- */

    addArrow() {
        const fabric = window.fabric;

        if (!fabric || !this.canvas) {
            return;
        }

        this.setSelect();

        const point = this._getInsertPoint();

        const arrow = createWhiteboardArrow(fabric, {
            left: point.x,
            top: point.y,
            color: this.state.color,
            strokeWidth: this.state.width,
        });

        this.canvas.add(arrow);
        this.canvas.setActiveObject(arrow);
        this.canvas.requestRenderAll();

        this._pushHistory(true, {
            rollbackObjects: [arrow],
        });
    }

    /* -------------------------------------------------------------------------
     * Mind map nodes
     * ------------------------------------------------------------------------- */

    addMindNode() {
        const fabric = window.fabric;

        if (!fabric || !this.canvas) {
            return;
        }

        this.setSelect();

        const point = this._getInsertPoint();

        const node = createWhiteboardMindNode(fabric, {
            left: point.x,
            top: point.y,
            color: this.state.color,
            text: "New idea",
        });

        this.canvas.add(node);
        this.canvas.setActiveObject(node);
        this.canvas.requestRenderAll();

        this._pushHistory(true, {
            rollbackObjects: [node],
        });
    }

    addMindChild() {
        const fabric = window.fabric;

        if (!fabric || !this.canvas) {
            return;
        }

        const parentNode = this._getNodeFromTarget(this.canvas.getActiveObject());

        if (!parentNode || parentNode.wbType !== "mind_node") {
            this.notification.add("Select a mind-map node first.", { type: "warning" });
            return;
        }

        this.setSelect();

        const parentCenter = parentNode.getCenterPoint();

        const childNode = createWhiteboardMindNode(fabric, {
            left: parentCenter.x + 330,
            top: parentCenter.y,
            color: this.state.color,
            text: "New idea",
            parentNodeId: parentNode.wbId,
        });

        this.canvas.add(childNode);

        const connector = this._createConnectorBetweenObjects(parentNode, childNode, {
            connectorType: "mind_arrow",
        });

        if (connector) {
            this.canvas.add(connector);
            this.canvas.sendToBack(connector);
        }

        this.canvas.setActiveObject(childNode);
        this.canvas.requestRenderAll();

        const addedObjects = [childNode];

        if (connector) {
            addedObjects.push(connector);
        }

        this._pushHistory(true, {
            rollbackObjects: addedObjects,
        });
    }

    /* -------------------------------------------------------------------------
     * Flowchart nodes
     * ------------------------------------------------------------------------- */

    _addFlowNode(nodeType) {
        const fabric = window.fabric;

        if (!fabric || !this.canvas) {
            return;
        }

        this.setSelect();

        const point = this._getInsertPoint();

        const node = createWhiteboardFlowNode(fabric, {
            left: point.x,
            top: point.y,
            color: this.state.color,
            nodeType,
        });

        this.canvas.add(node);
        this.canvas.setActiveObject(node);
        this.canvas.requestRenderAll();

        this._pushHistory(true, {
            rollbackObjects: [node],
        });
    }

    addFlowTerminator() {
        this._addFlowNode("terminator");
    }

    addFlowProcess() {
        this._addFlowNode("process");
    }

    addFlowDecision() {
        this._addFlowNode("decision");
    }

    addFlowData() {
        this._addFlowNode("data");
    }

    /* -------------------------------------------------------------------------
     * Generic node editing
     * ------------------------------------------------------------------------- */

    editSelectedNode() {
        const node = this._getNodeFromTarget(this.canvas?.getActiveObject());

        if (!node) {
            this.notification.add("Select a mind-map or flowchart node first.", { type: "warning" });
            return;
        }

        this._editNode(node);
    }

    // Keep backward compatibility with current XML if the old method name is still used.
    editSelectedMindNode() {
        this.editSelectedNode();
    }

    _editNodeFromTarget(target) {
        const node = this._getNodeFromTarget(target);

        if (node) {
            this._editNode(node);
        }
    }

    _editNode(node) {
        if (!node) return;

        const currentText = node.wbText || this._getNodeText(node) || "";
        const nextText = window.prompt("Node text", currentText);

        if (nextText === null) {
            return;
        }

        const cleanText = nextText.trim() || "New idea";

        this._setNodeText(node, cleanText);
        this.canvas.setActiveObject(node);
        this.canvas.requestRenderAll();

        this._pushHistory();
    }

    _getNodeFromTarget(target) {
        if (!target) {
            return null;
        }

        if (target.wbType === "mind_node" || target.wbType === "flow_node") {
            return target;
        }

        if (
            target.group
            && (
                target.group.wbType === "mind_node"
                || target.group.wbType === "flow_node"
            )
        ) {
            return target.group;
        }

        return null;
    }

    _getNodeText(node) {
        if (!node || !node.getObjects) {
            return "";
        }

        const textObject = node.getObjects().find((object) => object.wbRole === "node_text");

        return textObject?.text || "";
    }

    _setNodeText(node, text) {
        if (!node || !node.getObjects) {
            return;
        }

        const textObject = node.getObjects().find((object) => object.wbRole === "node_text");

        if (textObject) {
            textObject.set("text", text);
        }

        node.set("wbText", text);
        node.dirty = true;
        node.setCoords();
    }

    /* -------------------------------------------------------------------------
     * Connector mode
     * ------------------------------------------------------------------------- */

    _handleConnectorMouseDown(ev) {
        if (this.state.mode !== "connector" || !this.canvas) {
            return;
        }

        const target = this._getConnectableObjectFromTarget(ev.target);

        if (!target) {
            this.state.connectorFromNodeId = null;
            this.canvas.discardActiveObject();
            this.canvas.requestRenderAll();

            this.notification.add("Click a shape, mind-map node, or flowchart node to start a connector.", {
                type: "warning",
            });
            return;
        }

        if (!this.state.connectorFromNodeId) {
            this.state.connectorFromNodeId = target.wbId;
            this.canvas.setActiveObject(target);
            this.canvas.requestRenderAll();

            this.notification.add("Source selected. Click the target object.", {
                type: "info",
            });
            return;
        }

        const source = this._getObjectByWhiteboardId(this.state.connectorFromNodeId);

        if (!source) {
            this.state.connectorFromNodeId = null;
            this.notification.add("Source object was not found. Start connector again.", {
                type: "warning",
            });
            return;
        }

        if (source.wbId === target.wbId) {
            this.notification.add("Choose a different target object.", {
                type: "warning",
            });
            return;
        }

        const connector = this._createConnectorBetweenObjects(source, target, {
            connectorType: "straight_arrow",
        });

        if (!connector) {
            this.notification.add("Could not create connector.", {
                type: "warning",
            });
            return;
        }

        this.canvas.add(connector);
        this.canvas.sendToBack(connector);
        this.canvas.setActiveObject(target);
        this.canvas.requestRenderAll();

        this.state.connectorFromNodeId = null;

        const accepted = this._pushHistory(true, {
            rollbackObjects: [connector],
        });

        if (!accepted) {
            this.state.connectorFromNodeId = null;
            return;
        }
    }

    /* -------------------------------------------------------------------------
     * Generic connectable objects
     * ------------------------------------------------------------------------- */

    _getConnectableObjectFromTarget(target) {
        if (!target) {
            return null;
        }

        if (target.group) {
            return this._getConnectableObjectFromTarget(target.group);
        }

        if (target.type === "activeSelection") {
            return null;
        }

        if (target.wbType === "mind_node" || target.wbType === "flow_node") {
            return target;
        }

        if (
            target.wbType === "shape"
            && ["rectangle", "circle", "diamond"].includes(target.wbShape)
        ) {
            return target;
        }

        return null;
    }

    _createConnectorBetweenObjects(fromObject, toObject, options = {}) {
        const fabric = window.fabric;

        if (!fabric || !fromObject || !toObject) {
            return null;
        }

        const fromPoint = this._getObjectAnchorPoint(fromObject, toObject);
        const toPoint = this._getObjectAnchorPoint(toObject, fromObject);

        return createWhiteboardConnector(fabric, {
            fromPoint,
            toPoint,
            color: options.color || this.state.color,
            strokeWidth: options.strokeWidth || 3,
            wbId: options.wbId,
            fromNodeId: fromObject.wbId,
            toNodeId: toObject.wbId,
            connectorType: options.connectorType || "straight_arrow",
        });
    }

    _getObjectAnchorPoint(object, otherObject) {
        const center = object.getCenterPoint();
        const otherCenter = otherObject.getCenterPoint();
        const bounds = object.getBoundingRect();

        const dx = otherCenter.x - center.x;
        const dy = otherCenter.y - center.y;

        const halfWidth = Math.max(30, bounds.width / 2);
        const halfHeight = Math.max(24, bounds.height / 2);

        if (Math.abs(dx) >= Math.abs(dy)) {
            return {
                x: center.x + (dx >= 0 ? halfWidth : -halfWidth),
                y: center.y,
            };
        }

        return {
            x: center.x,
            y: center.y + (dy >= 0 ? halfHeight : -halfHeight),
        };
    }

    _getObjectByWhiteboardId(wbId) {
        if (!wbId || !this.canvas) {
            return null;
        }

        return this.canvas.getObjects().find((object) => object.wbId === wbId) || null;
    }

    _isConnector(object) {
        return object?.wbType === "connector";
    }

    _updateConnectorsForObject(object) {
        const connectableObject = this._getConnectableObjectFromTarget(object);

        if (!connectableObject || !this.canvas) {
            return;
        }

        const connectors = this.canvas
            .getObjects()
            .filter((candidate) => {
                return this._isConnector(candidate)
                    && (
                        candidate.wbFromNodeId === connectableObject.wbId
                        || candidate.wbToNodeId === connectableObject.wbId
                    );
            });

        for (const connector of connectors) {
            this._replaceConnectorWithUpdatedVersion(connector);
        }

        this.canvas.requestRenderAll();
    }

    _updateAllConnectors() {
        if (!this.canvas) {
            return;
        }

        const connectors = this.canvas
            .getObjects()
            .filter((object) => this._isConnector(object));

        for (const connector of connectors) {
            this._replaceConnectorWithUpdatedVersion(connector);
        }

        this.canvas.requestRenderAll();
    }

    _replaceConnectorWithUpdatedVersion(connector) {
        if (!connector || !this.canvas) {
            return;
        }

        const fromObject = this._getObjectByWhiteboardId(connector.wbFromNodeId);
        const toObject = this._getObjectByWhiteboardId(connector.wbToNodeId);

        if (!fromObject || !toObject) {
            return;
        }

        const updatedConnector = this._createConnectorBetweenObjects(fromObject, toObject, {
            wbId: connector.wbId,
            color: connector.stroke || this.state.color,
            strokeWidth: connector.strokeWidth || 3,
            connectorType: connector.wbConnectorType || "straight_arrow",
        });

        if (!updatedConnector) {
            return;
        }

        const index = this.canvas.getObjects().indexOf(connector);

        this._runWithoutHistory(() => {
            this.canvas.remove(connector);

            if (index >= 0) {
                this.canvas.insertAt(updatedConnector, index, false);
            } else {
                this.canvas.add(updatedConnector);
            }

            this.canvas.sendToBack(updatedConnector);
        });
    }

    deleteSelectedObjects() {
        if (!this.canvas) {
            return;
        }

        const activeObject = this.canvas.getActiveObject();

        if (!activeObject) {
            this.notification.add("Select an object to remove.", { type: "warning" });
            return;
        }

        // Do not delete while editing Fabric text.
        if (activeObject.isEditing) {
            return;
        }

        const selectedObjects = activeObject.type === "activeSelection"
            ? [...activeObject.getObjects()]
            : [activeObject];

        const objectsToRemove = this._getObjectsToRemoveWithConnectors(selectedObjects);

        this._runWithoutHistory(() => {
            this.canvas.discardActiveObject();

            for (const object of objectsToRemove) {
                if (this.canvas.getObjects().includes(object)) {
                    this.canvas.remove(object);
                }
            }
        });

        this.state.connectorFromNodeId = null;
        this.canvas.requestRenderAll();
        this._pushHistory();
    }

    _getObjectsToRemoveWithConnectors(objects) {
        if (!this.canvas) {
            return [];
        }

        const removeSet = new Set(objects);
        const selectedIds = objects
            .map((object) => object?.wbId)
            .filter(Boolean);

        if (!selectedIds.length) {
            return [...removeSet];
        }

        const attachedConnectors = this.canvas
            .getObjects()
            .filter((object) => {
                return object?.wbType === "connector"
                    && (
                        selectedIds.includes(object.wbFromNodeId)
                        || selectedIds.includes(object.wbToNodeId)
                    );
            });

        for (const connector of attachedConnectors) {
            removeSet.add(connector);
        }

        return [...removeSet];
    }

    // -------------------------------------------------------------------------
    // Server load/save
    // -------------------------------------------------------------------------

    async _loadBoardsList({ append = false } = {}) {
        if (this.state.boardsLoading) {
            return this.state.boards;
        }

        this.state.boardsLoading = true;

        const previousListState = {
            boards: [...this.state.boards],
            hasMore: this.state.boardsHasMore,
            nextOffset: this.state.boardsNextOffset,
        };

        const offset = append ? this.state.boardsNextOffset : 0;

        try {
            const result = await this.orm.call(
                "whiteboard.board",
                "get_user_boards",
                [offset, BOARD_LIST_PAGE_SIZE, this.state.boardId]
            );
            if (!this._isValidBoardListPayload(result)) {
                throw new Error(
                    "Invalid whiteboard-list response"
                );
            }

            const pageBoards = Array.isArray(result?.boards) ? result.boards : [];
            const currentBoard = result?.current_board || null;

            const candidates = append
                ? [...this.state.boards, ...pageBoards]
                : [...(currentBoard ? [currentBoard] : []), ...pageBoards];

            const seenBoardIds = new Set();

            this.state.boards = candidates.filter((board) => {
                if (!board || !Number.isInteger(board.id) || seenBoardIds.has(board.id)) {
                    return false;
                }

                seenBoardIds.add(board.id);
                return true;
            });

            this.state.boardsHasMore = Boolean(result?.has_more);
            this.state.boardsNextOffset = Number.isInteger(result?.next_offset)
                ? result.next_offset
                : offset + pageBoards.length;

            return this.state.boards;
        } catch {
            /*
             * Preserve the existing selector contents. A temporary list RPC
             * failure must not make the currently open board disappear.
             */
            this.state.boards = previousListState.boards;
            this.state.boardsHasMore = previousListState.hasMore;
            this.state.boardsNextOffset = previousListState.nextOffset;

            this.notification.add(
                append
                    ? "Could not load more whiteboards."
                    : "Could not refresh the whiteboard list.",
                {
                    type: "danger",
                }
            );

            return this.state.boards;
        } finally {
            this.state.boardsLoading = false;
        }
    }

    async loadMoreBoards() {
        if (this.state.boardsLoading || !this.state.boardsHasMore) {
            return;
        }

        await this._loadBoardsList({ append: true });
    }

    async _loadBoardFromServer(boardId = null) {
        try {
            let result;

            if (boardId) {
                result = await this.orm.call(
                    "whiteboard.board",
                    "get_board_data",
                    [boardId]
                );
            } else {
                result = await this.orm.call(
                    "whiteboard.board",
                    "get_or_create_latest_board",
                    []
                );
            }

            if (result?.error) {
                this.notification.add(
                    result.error,
                    {
                        type: "danger",
                    }
                );

                return false;
            }

            if (!this._isValidBoardPayload(result)) {
                this.notification.add(
                    (
                        "The server returned invalid "
                        + "whiteboard data."
                    ),
                    {
                        type: "danger",
                    }
                );

                return false;
            }

            const applied = await this._applyBoardPayload(
                result
            );

            if (!applied) {
                return false;
            }

            await this._loadBoardsList();

            return true;
        } catch {
            this.notification.add(
                "Could not load whiteboard.",
                {
                    type: "danger",
                }
            );

            return false;
        }
    }

    async _applyBoardPayload(payload) {
        if (
            !this.canvas
            || !this._isValidBoardPayload(payload)
        ) {
            return false;
        }

        this._cancelAutosave();

        const previousCanvasJson = (
            this._getCanvasJSON()
        );

        const previousAutosaveBlockedReason = (
            this._autosaveBlockedReason
        );

        const previousAutosaveFailureNotified = (
            this._autosaveFailureNotified
        );

        const incomingDataJson = (
            typeof payload.data_json === "string"
            && payload.data_json
                ? payload.data_json
                : "{}"
        );

        const incomingCanvasStats = (
            this._analyzeCanvasJSON(
                incomingDataJson
            )
        );

        this.state.loadingMessage = (
            this._isLargeBoard(
                incomingCanvasStats
            )
                ? (
                    "Loading large whiteboard "
                    + `(${incomingCanvasStats.objects} objects)…`
                )
                : "Loading whiteboard…"
        );

        await this._waitForRenderFrame();

        let applied = true;

        if (payload.data_json) {
            applied = await this._applyJSON(
                payload.data_json
            );
        } else {
            this._runWithoutHistory(() => {
                this._clearCanvasObjects();
            });
        }

        if (!applied) {
            /*
             * Fabric may have partially changed the canvas before rejecting
             * malformed or incompatible JSON. Restore the previous canvas.
             */
            const restored = await this._applyJSON(
                previousCanvasJson,
                {
                    notify: false,
                }
            );

            this._autosaveBlockedReason = (
                previousAutosaveBlockedReason
            );

            this._autosaveFailureNotified = (
                previousAutosaveFailureNotified
            );

            this.state.loadingMessage = (
                "Loading whiteboard…"
            );

            if (!restored) {
                this.state.fatalError = (
                    "The previous whiteboard could not be restored. "
                    + "Reload the page before continuing."
                );

                this.notification.add(
                    (
                        "The previous whiteboard could "
                        + "not be restored."
                    ),
                    {
                        type: "danger",
                    }
                );
            } else if (
                this.state.dirty
                && !this._autosaveBlockedReason
            ) {
                this._scheduleAutosave();
            }

            return false;
        }

        /*
         * Change the active board metadata only after the incoming canvas
         * has loaded successfully.
         */
        this.state.boardId = payload.id;
        this.state.boardName = (
            payload.name
            || "Untitled Board"
        );

        this.state.boardRevision = (
            payload.revision
        );

        this._savedBoardName = (
            this.state.boardName
        );

        this._nameDirty = false;
        this._autosaveBlockedReason = null;
        this._autosaveFailureNotified = false;
        this.state.fatalError = "";

        this._runWithoutHistory(() => {
            this._updateAllConnectors();
        });

        this._resetHistoryFromCanvas();

        this._resetDirtyState(
            this.state.boardName
        );

        this._resizeCanvas();

        this.state.loadingMessage = (
            "Loading whiteboard…"
        );

        return true;
    }

    reloadPage() {
        window.location.reload();
    }

    _isValidBoardPayload(payload) {
        return Boolean(
            payload
            && Number.isInteger(payload.id)
            && payload.id > 0
            && typeof payload.name === "string"
            && Number.isInteger(payload.revision)
            && payload.revision >= 0
            && (
                payload.data_json === false
                || payload.data_json === null
                || typeof payload.data_json === "string"
            )
        );
    }

    _isValidBoardListPayload(payload) {
        return Boolean(
            payload
            && Array.isArray(payload.boards)
            && Number.isInteger(payload.next_offset)
            && payload.next_offset >= 0
            && typeof payload.has_more === "boolean"
        );
    }

    _createSaveThumbnail() {
        if (!this.canvas) {
            return null;
        }

        try {
            const thumbnail = this.canvas.toDataURL({
                format: "jpeg",
                quality: THUMBNAIL_JPEG_QUALITY,
                multiplier: THUMBNAIL_MULTIPLIER,
            });

            this._thumbnailFailureNotified = false;

            return thumbnail;
        } catch {
            if (!this._thumbnailFailureNotified) {
                this.notification.add(
                    (
                        "The board preview could not be generated. "
                        + "The whiteboard content will still be saved."
                    ),
                    {
                        type: "warning",
                    }
                );
            }

            this._thumbnailFailureNotified = true;

            return null;
        }
    }

    async save() {
        this._cancelAutosave();
        await this._saveBoard({ manual: true });
    }

    async _saveBoard({ manual = false } = {}) {
        if (
            !this.canvas
            || !this.state.boardId
            || this.state.saving
            || !this.state.dirty
        ) {
            return false;
        }

        if (!manual && this._autosaveBlockedReason) {
            return false;
        }

        this._cancelAutosave();
        this._flushDebouncedHistory();

        const saveSnapshot = {
            boardId: this.state.boardId,
            boardRevision: this.state.boardRevision,
            boardName: this.state.boardName,
            canvasChangeVersion: this._canvasChangeVersion,
            nameChangeVersion: this._nameChangeVersion,
            dataJson: this._getCanvasJSON(),
        };

        const currentStats = this._analyzeCanvasJSON(saveSnapshot.dataJson);
        const latestHistoryEntry = this.undoStack[this.undoStack.length - 1];

        if (latestHistoryEntry?.json !== saveSnapshot.dataJson) {
            const limitError = this._getCanvasLimitError(currentStats, latestHistoryEntry);

            if (limitError) {
                this._updateCanvasUsage(currentStats);
                this.notification.add(limitError, { type: "warning" });
                return false;
            }
        }

        let nextAutosaveDelay = AUTOSAVE_DEBOUNCE_MS;

        let saveSucceeded = false;
        let saveFailed = false;

        this.state.saving = true;
        this._setSaveStatus("saving");

        try {
            const thumbnail = (
                this._createSaveThumbnail()
            );

            const result = await this.orm.call(
                "whiteboard.board",
                "save_my_board",
                [
                    saveSnapshot.boardId,
                    saveSnapshot.dataJson,
                    thumbnail,
                    saveSnapshot.boardName,
                    saveSnapshot.boardRevision,
                ]
            );

            if (result?.error) {
                saveFailed = true;

                this._autosaveBlockedReason = (
                    result.conflict
                        ? "conflict"
                        : "validation"
                );

                this.notification.add(
                    result.error,
                    {
                        type: result.conflict
                            ? "warning"
                            : "danger",
                    }
                );

                return false;
            }

            if (!result?.board) {
                saveFailed = true;
                this._autosaveBlockedReason = "validation";

                this.notification.add(
                    "The whiteboard save returned an invalid response.",
                    {
                        type: "danger",
                    }
                );

                return false;
            }

            this.state.boardId = result.board.id;

            if (Number.isInteger(result.board.revision)) {
                this.state.boardRevision = result.board.revision;
            }

            const savedName = (
                result.board.name
                || saveSnapshot.boardName
                || this._savedBoardName
                || "Untitled Board"
            );

            this._savedBoardName = savedName;

            if (this._canvasChangeVersion === saveSnapshot.canvasChangeVersion) {
                this._canvasDirty = false;
            }

            if (this._nameChangeVersion === saveSnapshot.nameChangeVersion) {
                this.state.boardName = savedName;
                this._nameDirty = false;
            } else {
                this._nameDirty = this.state.boardName !== savedName;
            }

            this._autosaveBlockedReason = null;
            this._autosaveFailureNotified = false;
            this._syncDirtyState();

            if (!this.state.dirty) {
                this._canvasChangeVersion = 0;
                this._nameChangeVersion = 0;
            }

            await this._loadBoardsList();

            saveSucceeded = true;

            if (manual) {
                this.notification.add(
                    "Whiteboard saved.",
                    {
                        type: "success",
                    }
                );
            }

            return true;
        } catch {
            saveFailed = true;
            nextAutosaveDelay = AUTOSAVE_RETRY_MS;

            if (
                manual
                || !this._autosaveFailureNotified
            ) {
                this.notification.add(
                    manual
                        ? (
                            "Could not save whiteboard. "
                            + "Changes remain unsaved."
                        )
                        : (
                            "Autosave failed. Changes remain unsaved; "
                            + "retrying automatically."
                        ),
                    {
                        type: "danger",
                    }
                );
            }

            this._autosaveFailureNotified = true;
            return false;
        } finally {
            this.state.saving = false;

            if (saveSucceeded) {
                /*
                 * The user may have edited the board while the request was
                 * in flight. In that case the successful request saved the
                 * earlier snapshot, not the newest edits.
                 */
                this._setSaveStatus(
                    this.state.dirty
                        ? "unsaved"
                        : "saved"
                );
            } else if (saveFailed) {
                this._setSaveStatus("error");
            } else if (this.state.dirty) {
                this._setSaveStatus("unsaved");
            }

            if (
                this.state.dirty
                && !this._autosaveBlockedReason
            ) {
                this._scheduleAutosave(
                    nextAutosaveDelay
                );
            }
        }
    }

    // -------------------------------------------------------------------------
    // Canvas performance limits
    // -------------------------------------------------------------------------

    _countSerializedCanvasObjects(objects) {
        if (!Array.isArray(objects)) {
            return 0;
        }

        let count = 0;

        for (const object of objects) {
            if (!object || typeof object !== "object") {
                continue;
            }

            count += 1;

            if (Array.isArray(object.objects)) {
                count += this._countSerializedCanvasObjects(object.objects);
            }
        }

        return count;
    }

    _analyzeCanvasJSON(json) {
        const safeJson = typeof json === "string" ? json : "{}";
        let objectCount = 0;

        try {
            const payload = JSON.parse(safeJson);
            objectCount = this._countSerializedCanvasObjects(payload?.objects);
        } catch {
            objectCount = 0;
        }

        return {
            objects: objectCount,
            bytes: this._getHistoryByteLength(safeJson),
        };
    }

    _formatCanvasBytes(bytes) {
        if (bytes < 1024) {
            return `${bytes} B`;
        }

        if (bytes < 1024 * 1024) {
            return `${Math.ceil(bytes / 1024)} KB`;
        }

        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    _isLargeBoard(stats) {
        return (
            stats.objects >= LARGE_BOARD_OBJECT_THRESHOLD
            || stats.bytes >= LARGE_BOARD_JSON_BYTES
        );
    }

    _updateCanvasUsage(stats) {
        const objectRatio = stats.objects / CANVAS_MAX_OBJECTS;
        const byteRatio = stats.bytes / CANVAS_MAX_JSON_BYTES;
        const largestRatio = Math.max(objectRatio, byteRatio);

        this.state.canvasObjectCount = stats.objects;
        this.state.canvasJsonBytes = stats.bytes;
        this.state.canvasLimitWarning = largestRatio >= CANVAS_WARNING_RATIO;
        this.state.canvasLimitExceeded = (
            stats.objects > CANVAS_MAX_OBJECTS
            || stats.bytes > CANVAS_MAX_JSON_BYTES
        );
        this.state.canvasUsageText = (
            `${stats.objects}/${CANVAS_MAX_OBJECTS} objects`
            + " · "
            + `${this._formatCanvasBytes(stats.bytes)}/${this._formatCanvasBytes(CANVAS_MAX_JSON_BYTES)}`
        );
    }

    _getPreviousHistoryStats(entry) {
        if (!entry) {
            return null;
        }

        if (Number.isInteger(entry.objectCount) && Number.isFinite(entry.bytes)) {
            return {
                objects: entry.objectCount,
                bytes: entry.bytes,
            };
        }

        return this._analyzeCanvasJSON(entry.json);
    }

    _isReducingOversizedCanvas(nextStats, previousEntry) {
        const previousStats = this._getPreviousHistoryStats(previousEntry);

        if (!previousStats) {
            return false;
        }

        const objectCountNotWorse = nextStats.objects <= previousStats.objects;
        const byteCountNotWorse = nextStats.bytes <= previousStats.bytes;
        const strictlyImproved = (
            nextStats.objects < previousStats.objects
            || nextStats.bytes < previousStats.bytes
        );

        return objectCountNotWorse && byteCountNotWorse && strictlyImproved;
    }

    _getCanvasLimitError(stats, previousEntry) {
        const objectLimitExceeded = stats.objects > CANVAS_MAX_OBJECTS;
        const byteLimitExceeded = stats.bytes > CANVAS_MAX_JSON_BYTES;

        if (!objectLimitExceeded && !byteLimitExceeded) {
            return null;
        }

        if (this._isReducingOversizedCanvas(stats, previousEntry)) {
            return null;
        }

        if (objectLimitExceeded && byteLimitExceeded) {
            return (
                "Canvas limit reached. Remove some objects or simplify long drawings "
                + "before adding more content."
            );
        }

        if (objectLimitExceeded) {
            return (
                `Canvas contains more than ${CANVAS_MAX_OBJECTS} objects. `
                + "Remove some objects before adding more."
            );
        }

        return (
            "Canvas data is too complex. Remove some objects or simplify long "
            + "freehand drawings before adding more."
        );
    }

    _rejectAddedCanvasObjects(objects, previousEntry, message) {
        const rejectedObjects = Array.isArray(objects) ? objects.filter(Boolean) : [];
        const rejectedObjectSet = new Set(rejectedObjects);
        const rejectedIds = new Set(
            rejectedObjects
                .map((object) => object?.wbId)
                .filter(Boolean)
        );

        this._cancelAutosave();

        this._runWithoutHistory(() => {
            this.canvas.discardActiveObject();

            const canvasObjects = [...this.canvas.getObjects()];

            for (const object of canvasObjects) {
                if (
                    rejectedObjectSet.has(object)
                    || (object?.wbId && rejectedIds.has(object.wbId))
                ) {
                    this.canvas.remove(object);
                }
            }
        });

        this.canvas.requestRenderAll();

        if (previousEntry) {
            this._updateCanvasUsage(this._getPreviousHistoryStats(previousEntry));
        }

        this.notification.add(message, { type: "warning" });

        if (this.state.dirty) {
            this._scheduleAutosave();
        }
    }

    _rollbackRejectedCanvasChange(previousEntry, message) {
        if (this._limitRollbackInProgress) {
            return;
        }

        this._cancelAutosave();
        this.notification.add(message, { type: "warning" });

        if (!previousEntry?.json) {
            if (this.state.dirty) {
                this._scheduleAutosave();
            }
            return;
        }

        this._limitRollbackInProgress = true;

        void this._applyJSON(previousEntry.json)
            .then((ok) => {
                if (ok) {
                    this._updateCanvasUsage(this._getPreviousHistoryStats(previousEntry));
                }
            })
            .finally(() => {
                this._limitRollbackInProgress = false;

                if (this.state.dirty) {
                    this._scheduleAutosave();
                }
            });
    }

    _waitForRenderFrame() {
        return new Promise((resolve) => {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(resolve);
            });
        });
    }

    // -------------------------------------------------------------------------
    // History helpers
    // -------------------------------------------------------------------------

    _getHistoryByteLength(json) {
        if (this._historyEncoder) {
            return this._historyEncoder.encode(json).byteLength;
        }

        return new Blob([json]).size;
    }

    _createHistoryEntry(json, stats = null) {
        const analyzedStats = stats || this._analyzeCanvasJSON(json);

        return {
            json,
            bytes: analyzedStats.bytes,
            objectCount: analyzedStats.objects,
        };
    }

    _getHistoryTotalBytes() {
        let totalBytes = 0;

        for (const entry of this.undoStack) {
            totalBytes += entry.bytes;
        }

        for (const entry of this.redoStack) {
            totalBytes += entry.bytes;
        }

        return totalBytes;
    }

    _trimHistoryToBudget() {
        let totalEntries = this.undoStack.length + this.redoStack.length;
        let totalBytes = this._getHistoryTotalBytes();

        while (
            this.undoStack.length > 1
            && (
                totalEntries > HISTORY_MAX_ENTRIES
                || totalBytes > HISTORY_MAX_TOTAL_BYTES
            )
        ) {
            const removed = this.undoStack.shift();
            totalEntries -= 1;
            totalBytes -= removed.bytes;
        }

        while (
            this.redoStack.length
            && (
                totalEntries > HISTORY_MAX_ENTRIES
                || totalBytes > HISTORY_MAX_TOTAL_BYTES
            )
        ) {
            const removed = this.redoStack.shift();
            totalEntries -= 1;
            totalBytes -= removed.bytes;
        }
    }

    _getCanvasJSON() {
        return JSON.stringify(this.canvas.toDatalessJSON(WHITEBOARD_OBJECT_PROPS));
    }

    _pushHistory(resetRedo = true, options = {}) {
        if (
            !this.canvas
            || this._isApplyingHistory
            || this._limitRollbackInProgress
        ) {
            return false;
        }

        const markDirty = options.markDirty !== false;
        const enforceLimits = options.enforceLimits !== false;
        const rollbackObjects = Array.isArray(options.rollbackObjects)
            ? options.rollbackObjects
            : [];

        const json = this._getCanvasJSON();
        const latest = this.undoStack[this.undoStack.length - 1];

        if (latest?.json === json) {
            this._updateCanvasUsage(
                this._getPreviousHistoryStats(
                    latest
                )
            );

            this._syncHistoryAvailability();

            return true;
        }

        const stats = this._analyzeCanvasJSON(json);

        if (enforceLimits) {
            const limitError = this._getCanvasLimitError(stats, latest);

            if (limitError) {
                if (rollbackObjects.length) {
                    this._rejectAddedCanvasObjects(rollbackObjects, latest, limitError);
                } else {
                    this._rollbackRejectedCanvasChange(latest, limitError);
                }

                return false;
            }
        }

        const entry = this._createHistoryEntry(json, stats);
        this.undoStack.push(entry);

        if (resetRedo) {
            this.redoStack = [];
        }

        this._trimHistoryToBudget();
        this._syncHistoryAvailability();
        this._updateCanvasUsage(stats);

        if (markDirty) {
            this._markCanvasDirty();
        }

        return true;
    }
    _pushHistoryDebounced() {
        if (this._historyTimer) {
            clearTimeout(this._historyTimer);
        }

        this._historyTimer = setTimeout(() => {
            this._historyTimer = null;
            this._pushHistory();
        }, 350);
    }

    _flushDebouncedHistory() {
        if (!this._historyTimer) return;

        clearTimeout(this._historyTimer);
        this._historyTimer = null;
        this._pushHistory();
    }

    _resetHistoryFromCanvas() {
        if (!this.canvas) {
            return;
        }

        this.undoStack = [];
        this.redoStack = [];

        this._pushHistory(true, {
            markDirty: false,
            enforceLimits: false,
        });

        this._canvasDirty = false;

        this._syncHistoryAvailability();
        this._syncDirtyState();
    }

    _runWithoutHistory(callback) {
        this._isApplyingHistory = true;

        try {
            callback();
        } finally {
            this._isApplyingHistory = false;
        }
    }

    _clearCanvasObjects() {
        if (!this.canvas) return;

        this.canvas.discardActiveObject();

        const objects = [...this.canvas.getObjects()];
        for (const object of objects) {
            this.canvas.remove(object);
        }

        this.canvas.backgroundColor = "white";
        this.canvas.requestRenderAll();
    }

    async _applyJSON(
        json,
        {
            notify = true,
        } = {}
    ) {
        if (!this.canvas) {
            return false;
        }

        let parsed = json;

        try {
            if (typeof json === "string") {
                parsed = JSON.parse(json);
            }
        } catch {
            if (notify) {
                this.notification.add(
                    (
                        "Saved board data is "
                        + "not valid JSON."
                    ),
                    {
                        type: "danger",
                    }
                );
            }

            return false;
        }

        this._isApplyingHistory = true;

        try {
            await new Promise(
                (resolve, reject) => {
                    try {
                        this.canvas.loadFromJSON(
                            parsed,
                            () => {
                                this.canvas.requestRenderAll();
                                resolve();
                            }
                        );
                    } catch (error) {
                        reject(error);
                    }
                }
            );

            return true;
        } catch {
            if (notify) {
                this.notification.add(
                    (
                        "Could not render saved "
                        + "whiteboard data."
                    ),
                    {
                        type: "danger",
                    }
                );
            }

            return false;
        } finally {
            this._isApplyingHistory = false;
        }
    }
}

WhiteboardAction.template = "odoo_whiteboard.WhiteboardAction";

registry.category("actions").add("odoo_whiteboard.whiteboard_action", WhiteboardAction);
