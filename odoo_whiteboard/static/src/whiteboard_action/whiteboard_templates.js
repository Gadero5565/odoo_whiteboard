/** @odoo-module **/

import {
    createWhiteboardMindNode,
    createWhiteboardFlowNode,
    createWhiteboardConnector,
} from "./whiteboard_objects";

export const WHITEBOARD_TEMPLATES = [
    {
        code: "mind_map",
        name: "Mind Map",
        icon: "fa-sitemap",
    },
    {
        code: "project_plan",
        name: "Project Plan",
        icon: "fa-tasks",
    },
    {
        code: "basic_flowchart",
        name: "Flowchart",
        icon: "fa-share-alt",
    },
    {
        code: "project_workflow",
        name: "Workflow",
        icon: "fa-random",
    },
];

function getObjectAnchorPoint(object, otherObject) {
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

function createConnectorBetweenObjects(fabric, fromObject, toObject, options = {}) {
    const fromPoint = getObjectAnchorPoint(fromObject, toObject);
    const toPoint = getObjectAnchorPoint(toObject, fromObject);

    return createWhiteboardConnector(fabric, {
        fromPoint,
        toPoint,
        color: options.color || "#111111",
        strokeWidth: options.strokeWidth || 3,
        fromNodeId: fromObject.wbId,
        toNodeId: toObject.wbId,
        connectorType: options.connectorType || "template_arrow",
    });
}

function addMindNode(fabric, items, options) {
    const node = createWhiteboardMindNode(fabric, options);
    items.nodes.push(node);
    items.objects.push(node);
    return node;
}

function addFlowNode(fabric, items, options) {
    const node = createWhiteboardFlowNode(fabric, options);
    items.nodes.push(node);
    items.objects.push(node);
    return node;
}

function addConnector(fabric, items, fromObject, toObject, options = {}) {
    const connector = createConnectorBetweenObjects(fabric, fromObject, toObject, options);

    if (connector) {
        items.connectors.push(connector);
        items.objects.push(connector);
    }

    return connector;
}

function createTemplateResult({ objects, nodes, connectors, activeObject = null }) {
    return {
        objects,
        nodes,
        connectors,
        activeObject: activeObject || nodes[0] || objects[0] || null,
    };
}

/* -------------------------------------------------------------------------
 * Mind Map
 * ------------------------------------------------------------------------- */

function buildMindMapTemplate(fabric, options = {}) {
    const {
        centerX,
        centerY,
        color = "#111111",
    } = options;

    const items = {
        objects: [],
        nodes: [],
        connectors: [],
    };

    const root = addMindNode(fabric, items, {
        left: centerX,
        top: centerY,
        color,
        text: "Main Idea",
    });

    const topic1 = addMindNode(fabric, items, {
        left: centerX - 330,
        top: centerY - 150,
        color,
        text: "Topic 1",
        parentNodeId: root.wbId,
    });

    const topic2 = addMindNode(fabric, items, {
        left: centerX + 330,
        top: centerY - 150,
        color,
        text: "Topic 2",
        parentNodeId: root.wbId,
    });

    const topic3 = addMindNode(fabric, items, {
        left: centerX - 330,
        top: centerY + 150,
        color,
        text: "Topic 3",
        parentNodeId: root.wbId,
    });

    const topic4 = addMindNode(fabric, items, {
        left: centerX + 330,
        top: centerY + 150,
        color,
        text: "Topic 4",
        parentNodeId: root.wbId,
    });

    for (const topic of [topic1, topic2, topic3, topic4]) {
        addConnector(fabric, items, root, topic, {
            color,
            connectorType: "mind_arrow",
        });
    }

    return createTemplateResult({
        ...items,
        activeObject: root,
    });
}

/* -------------------------------------------------------------------------
 * Project Plan
 * ------------------------------------------------------------------------- */

function buildProjectPlanTemplate(fabric, options = {}) {
    const {
        centerX,
        centerY,
        color = "#111111",
    } = options;

    const items = {
        objects: [],
        nodes: [],
        connectors: [],
    };

    const root = addMindNode(fabric, items, {
        left: centerX,
        top: centerY,
        color,
        text: "Project Name",
    });

    const goals = addMindNode(fabric, items, {
        left: centerX - 360,
        top: centerY - 170,
        color,
        text: "Goals",
        parentNodeId: root.wbId,
    });

    const tasks = addMindNode(fabric, items, {
        left: centerX + 360,
        top: centerY - 170,
        color,
        text: "Tasks",
        parentNodeId: root.wbId,
    });

    const risks = addMindNode(fabric, items, {
        left: centerX - 360,
        top: centerY + 20,
        color,
        text: "Risks",
        parentNodeId: root.wbId,
    });

    const timeline = addMindNode(fabric, items, {
        left: centerX + 360,
        top: centerY + 20,
        color,
        text: "Timeline",
        parentNodeId: root.wbId,
    });

    const team = addMindNode(fabric, items, {
        left: centerX,
        top: centerY + 210,
        color,
        text: "Team",
        parentNodeId: root.wbId,
    });

    for (const node of [goals, tasks, risks, timeline, team]) {
        addConnector(fabric, items, root, node, {
            color,
            connectorType: "mind_arrow",
        });
    }

    return createTemplateResult({
        ...items,
        activeObject: root,
    });
}

/* -------------------------------------------------------------------------
 * Basic Flowchart
 * ------------------------------------------------------------------------- */

function buildBasicFlowchartTemplate(fabric, options = {}) {
    const {
        centerX,
        centerY,
        color = "#111111",
    } = options;

    const items = {
        objects: [],
        nodes: [],
        connectors: [],
    };

    const start = addFlowNode(fabric, items, {
        left: centerX,
        top: centerY - 260,
        color,
        nodeType: "terminator",
        text: "Start",
    });

    const process = addFlowNode(fabric, items, {
        left: centerX,
        top: centerY - 100,
        color,
        nodeType: "process",
        text: "Process",
    });

    const decision = addFlowNode(fabric, items, {
        left: centerX,
        top: centerY + 80,
        color,
        nodeType: "decision",
        text: "Decision?",
    });

    const yesProcess = addFlowNode(fabric, items, {
        left: centerX + 330,
        top: centerY + 80,
        color,
        nodeType: "process",
        text: "Yes path",
    });

    const end = addFlowNode(fabric, items, {
        left: centerX,
        top: centerY + 270,
        color,
        nodeType: "terminator",
        text: "End",
    });

    addConnector(fabric, items, start, process, { color });
    addConnector(fabric, items, process, decision, { color });
    addConnector(fabric, items, decision, yesProcess, { color });
    addConnector(fabric, items, decision, end, { color });
    addConnector(fabric, items, yesProcess, end, { color });

    return createTemplateResult({
        ...items,
        activeObject: start,
    });
}

/* -------------------------------------------------------------------------
 * Project Workflow
 * ------------------------------------------------------------------------- */

function buildProjectWorkflowTemplate(fabric, options = {}) {
    const {
        centerX,
        centerY,
        color = "#111111",
    } = options;

    const items = {
        objects: [],
        nodes: [],
        connectors: [],
    };

    const request = addFlowNode(fabric, items, {
        left: centerX - 420,
        top: centerY - 170,
        color,
        nodeType: "terminator",
        text: "Request",
    });

    const review = addFlowNode(fabric, items, {
        left: centerX - 120,
        top: centerY - 170,
        color,
        nodeType: "process",
        text: "Review",
    });

    const approved = addFlowNode(fabric, items, {
        left: centerX + 190,
        top: centerY - 170,
        color,
        nodeType: "decision",
        text: "Approved?",
    });

    const execute = addFlowNode(fabric, items, {
        left: centerX + 500,
        top: centerY - 170,
        color,
        nodeType: "process",
        text: "Execute",
    });

    const done = addFlowNode(fabric, items, {
        left: centerX + 500,
        top: centerY + 70,
        color,
        nodeType: "terminator",
        text: "Done",
    });

    const changes = addFlowNode(fabric, items, {
        left: centerX + 190,
        top: centerY + 100,
        color,
        nodeType: "process",
        text: "Request Changes",
    });

    addConnector(fabric, items, request, review, { color });
    addConnector(fabric, items, review, approved, { color });
    addConnector(fabric, items, approved, execute, { color });
    addConnector(fabric, items, execute, done, { color });
    addConnector(fabric, items, approved, changes, { color });
    addConnector(fabric, items, changes, review, { color });

    return createTemplateResult({
        ...items,
        activeObject: request,
    });
}

/* -------------------------------------------------------------------------
 * Public builder
 * ------------------------------------------------------------------------- */

export function buildWhiteboardTemplate(fabric, templateCode, options = {}) {
    switch (templateCode) {
        case "mind_map":
            return buildMindMapTemplate(fabric, options);
        case "project_plan":
            return buildProjectPlanTemplate(fabric, options);
        case "basic_flowchart":
            return buildBasicFlowchartTemplate(fabric, options);
        case "project_workflow":
            return buildProjectWorkflowTemplate(fabric, options);
        default:
            return null;
    }
}

