/** @odoo-module **/

export const WHITEBOARD_OBJECT_PROPS = [
    "wbId",
    "wbType",
    "wbShape",
    "wbVersion",

    // Group child roles
    "wbRole",

    // Node data
    "wbText",
    "wbNodeType",
    "wbParentNodeId",

    // Connector data
    "wbConnectorType",
    "wbFromNodeId",
    "wbToNodeId",
];

function createWhiteboardId(prefix = "wb") {
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now()}_${randomPart}`;
}

function getStrokeWidth(width, max = 12) {
    const parsed = Number(width) || 2;
    return Math.max(1, Math.min(parsed, max));
}

function getShapeBaseStyle({ color = "#111111", strokeWidth = 2 } = {}) {
    return {
        fill: "rgba(255, 255, 255, 0.96)",
        stroke: color,
        strokeWidth: getStrokeWidth(strokeWidth),
        transparentCorners: false,
        cornerStyle: "circle",
        borderColor: color,
        cornerColor: color,
        padding: 4,
    };
}

function decorateWhiteboardObject(object, props = {}) {
    object.set({
        wbId: props.wbId || createWhiteboardId(props.wbShape || props.wbType || "object"),
        wbType: props.wbType,
        wbShape: props.wbShape,
        wbVersion: props.wbVersion || 1,

        wbRole: props.wbRole,
        wbText: props.wbText,
        wbNodeType: props.wbNodeType,
        wbParentNodeId: props.wbParentNodeId,

        wbConnectorType: props.wbConnectorType,
        wbFromNodeId: props.wbFromNodeId,
        wbToNodeId: props.wbToNodeId,
    });

    return object;
}

function createArrowPath(fabric, options = {}) {
    const {
        left = 160,
        top = 120,
        length = 230,
        angle = 0,
        color = "#111111",
        strokeWidth = 3,
        selectable = true,
        evented = true,
    } = options;

    const safeLength = Math.max(60, Number(length) || 230);
    const half = safeLength / 2;
    const headLength = Math.min(22, safeLength * 0.25);
    const headWidth = 10;

    const pathData = [
        `M ${-half} 0`,
        `L ${half - headLength} 0`,
        `M ${half - headLength} ${-headWidth}`,
        `L ${half} 0`,
        `L ${half - headLength} ${headWidth}`,
    ].join(" ");

    return new fabric.Path(pathData, {
        left,
        top,
        originX: "center",
        originY: "center",
        angle,
        fill: null,
        stroke: color,
        strokeWidth: getStrokeWidth(strokeWidth, 10),
        strokeLineCap: "round",
        strokeLineJoin: "round",
        transparentCorners: false,
        cornerStyle: "circle",
        borderColor: color,
        cornerColor: color,
        padding: 8,
        selectable,
        evented,
        objectCaching: false,
    });
}

/* -------------------------------------------------------------------------
 * Basic shapes
 * ------------------------------------------------------------------------- */

export function createWhiteboardRectangle(fabric, options = {}) {
    const {
        left = 160,
        top = 120,
        color = "#111111",
        strokeWidth = 2,
    } = options;

    const rect = new fabric.Rect({
        left,
        top,
        originX: "center",
        originY: "center",
        width: 190,
        height: 110,
        rx: 10,
        ry: 10,
        ...getShapeBaseStyle({ color, strokeWidth }),
    });

    return decorateWhiteboardObject(rect, {
        wbType: "shape",
        wbShape: "rectangle",
    });
}

export function createWhiteboardCircle(fabric, options = {}) {
    const {
        left = 160,
        top = 120,
        color = "#111111",
        strokeWidth = 2,
    } = options;

    const circle = new fabric.Circle({
        left,
        top,
        originX: "center",
        originY: "center",
        radius: 62,
        ...getShapeBaseStyle({ color, strokeWidth }),
    });

    return decorateWhiteboardObject(circle, {
        wbType: "shape",
        wbShape: "circle",
    });
}

export function createWhiteboardDiamond(fabric, options = {}) {
    const {
        left = 160,
        top = 120,
        color = "#111111",
        strokeWidth = 2,
    } = options;

    const width = 180;
    const height = 120;

    const diamond = new fabric.Polygon(
        [
            { x: 0, y: -height / 2 },
            { x: width / 2, y: 0 },
            { x: 0, y: height / 2 },
            { x: -width / 2, y: 0 },
        ],
        {
            left,
            top,
            originX: "center",
            originY: "center",
            ...getShapeBaseStyle({ color, strokeWidth }),
        }
    );

    return decorateWhiteboardObject(diamond, {
        wbType: "shape",
        wbShape: "diamond",
    });
}

export function createWhiteboardLine(fabric, options = {}) {
    const {
        left = 160,
        top = 120,
        color = "#111111",
        strokeWidth = 3,
    } = options;

    const lineLength = 220;

    const line = new fabric.Line(
        [
            left - lineLength / 2,
            top,
            left + lineLength / 2,
            top,
        ],
        {
            stroke: color,
            strokeWidth: getStrokeWidth(strokeWidth, 10),
            strokeLineCap: "round",
            strokeLineJoin: "round",
            fill: color,
            transparentCorners: false,
            cornerStyle: "circle",
            borderColor: color,
            cornerColor: color,
            padding: 8,
            perPixelTargetFind: false,
        }
    );

    return decorateWhiteboardObject(line, {
        wbType: "shape",
        wbShape: "line",
    });
}

export function createWhiteboardArrow(fabric, options = {}) {
    const arrow = createArrowPath(fabric, options);

    return decorateWhiteboardObject(arrow, {
        wbType: "shape",
        wbShape: "arrow",
    });
}

/* -------------------------------------------------------------------------
 * Connectors
 * ------------------------------------------------------------------------- */

export function createWhiteboardConnector(fabric, options = {}) {
    const {
        fromPoint,
        toPoint,
        color = "#111111",
        strokeWidth = 3,
        wbId,
        fromNodeId,
        toNodeId,
        connectorType = "straight_arrow",
    } = options;

    if (!fromPoint || !toPoint) {
        return null;
    }

    const dx = toPoint.x - fromPoint.x;
    const dy = toPoint.y - fromPoint.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length < 10) {
        return null;
    }

    const left = fromPoint.x + dx / 2;
    const top = fromPoint.y + dy / 2;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    const connector = createArrowPath(fabric, {
        left,
        top,
        length,
        angle,
        color,
        strokeWidth,
        selectable: false,
        evented: false,
    });

    return decorateWhiteboardObject(connector, {
        wbId,
        wbType: "connector",
        wbShape: "arrow",
        wbConnectorType: connectorType,
        wbFromNodeId: fromNodeId,
        wbToNodeId: toNodeId,
    });
}

/* -------------------------------------------------------------------------
 * Mind map nodes
 * ------------------------------------------------------------------------- */

export function createWhiteboardMindNode(fabric, options = {}) {
    const {
        left = 160,
        top = 120,
        color = "#111111",
        text = "New idea",
        parentNodeId = null,
    } = options;

    const background = new fabric.Rect({
        left: -115,
        top: -42,
        width: 230,
        height: 84,
        rx: 18,
        ry: 18,
        fill: "rgba(255, 255, 255, 0.98)",
        stroke: color,
        strokeWidth: 2,
        selectable: false,
        evented: false,
    });

    decorateWhiteboardObject(background, {
        wbRole: "node_background",
    });

    const label = new fabric.Textbox(text, {
        left: -95,
        top: -14,
        width: 190,
        fontSize: 18,
        fontWeight: "600",
        textAlign: "center",
        fill: "#0f172a",
        selectable: false,
        evented: false,
    });

    decorateWhiteboardObject(label, {
        wbRole: "node_text",
    });

    const group = new fabric.Group([background, label], {
        left,
        top,
        originX: "center",
        originY: "center",
        transparentCorners: false,
        cornerStyle: "circle",
        borderColor: color,
        cornerColor: color,
        padding: 6,
        lockScalingFlip: true,
        objectCaching: false,
    });

    return decorateWhiteboardObject(group, {
        wbType: "mind_node",
        wbShape: "mind_node",
        wbNodeType: "mind_node",
        wbText: text,
        wbParentNodeId: parentNodeId,
    });
}

/* -------------------------------------------------------------------------
 * Flowchart nodes
 * ------------------------------------------------------------------------- */

function getFlowNodeDefaultText(nodeType) {
    switch (nodeType) {
        case "terminator":
            return "Start / End";
        case "process":
            return "Process";
        case "decision":
            return "Decision";
        case "data":
            return "Data";
        default:
            return "Flow node";
    }
}

function createFlowNodeBackground(fabric, nodeType, color) {
    if (nodeType === "terminator") {
        return new fabric.Rect({
            left: -115,
            top: -42,
            width: 230,
            height: 84,
            rx: 42,
            ry: 42,
            fill: "rgba(255, 255, 255, 0.98)",
            stroke: color,
            strokeWidth: 2,
            selectable: false,
            evented: false,
        });
    }

    if (nodeType === "decision") {
        return new fabric.Polygon(
            [
                { x: 0, y: -58 },
                { x: 118, y: 0 },
                { x: 0, y: 58 },
                { x: -118, y: 0 },
            ],
            {
                left: 0,
                top: 0,
                originX: "center",
                originY: "center",
                fill: "rgba(255, 255, 255, 0.98)",
                stroke: color,
                strokeWidth: 2,
                selectable: false,
                evented: false,
            }
        );
    }

    if (nodeType === "data") {
        return new fabric.Polygon(
            [
                { x: -100, y: -42 },
                { x: 120, y: -42 },
                { x: 100, y: 42 },
                { x: -120, y: 42 },
            ],
            {
                left: 0,
                top: 0,
                originX: "center",
                originY: "center",
                fill: "rgba(255, 255, 255, 0.98)",
                stroke: color,
                strokeWidth: 2,
                selectable: false,
                evented: false,
            }
        );
    }

    return new fabric.Rect({
        left: -115,
        top: -42,
        width: 230,
        height: 84,
        rx: 10,
        ry: 10,
        fill: "rgba(255, 255, 255, 0.98)",
        stroke: color,
        strokeWidth: 2,
        selectable: false,
        evented: false,
    });
}

export function createWhiteboardFlowNode(fabric, options = {}) {
    const {
        left = 160,
        top = 120,
        color = "#111111",
        nodeType = "process",
        text = getFlowNodeDefaultText(nodeType),
    } = options;

    const background = createFlowNodeBackground(fabric, nodeType, color);

    decorateWhiteboardObject(background, {
        wbRole: "node_background",
    });

    const label = new fabric.Textbox(text, {
        left: -82,
        top: -13,
        width: 164,
        fontSize: 16,
        fontWeight: "600",
        textAlign: "center",
        fill: "#0f172a",
        selectable: false,
        evented: false,
    });

    decorateWhiteboardObject(label, {
        wbRole: "node_text",
    });

    const group = new fabric.Group([background, label], {
        left,
        top,
        originX: "center",
        originY: "center",
        transparentCorners: false,
        cornerStyle: "circle",
        borderColor: color,
        cornerColor: color,
        padding: 6,
        lockScalingFlip: true,
        objectCaching: false,
    });

    return decorateWhiteboardObject(group, {
        wbType: "flow_node",
        wbShape: "flow_node",
        wbNodeType: nodeType,
        wbText: text,
    });
}

/* -------------------------------------------------------------------------
 * Factory
 * ------------------------------------------------------------------------- */

export function createWhiteboardShape(fabric, shape, options = {}) {
    switch (shape) {
        case "rectangle":
            return createWhiteboardRectangle(fabric, options);
        case "circle":
            return createWhiteboardCircle(fabric, options);
        case "diamond":
            return createWhiteboardDiamond(fabric, options);
        case "line":
            return createWhiteboardLine(fabric, options);
        case "arrow":
            return createWhiteboardArrow(fabric, options);
        case "mind_node":
            return createWhiteboardMindNode(fabric, options);
        case "flow_terminator":
            return createWhiteboardFlowNode(fabric, { ...options, nodeType: "terminator" });
        case "flow_process":
            return createWhiteboardFlowNode(fabric, { ...options, nodeType: "process" });
        case "flow_decision":
            return createWhiteboardFlowNode(fabric, { ...options, nodeType: "decision" });
        case "flow_data":
            return createWhiteboardFlowNode(fabric, { ...options, nodeType: "data" });
        default:
            return null;
    }
}

