const mermaidGraph = `graph TD
    A[Node A] --> B[Node B]
    A --> C[Node C]
    B --> D[Node D]
    C --> D
    D --> E[Node E]`;

function detectShape(bracket) {
    if (!bracket) return 'rect';
    const b = bracket.trim();
    if (b.startsWith('(') && b.endsWith(')') && !b.startsWith('([')) return 'stadium';
    if (b.startsWith('{{') && b.endsWith('}}')) return 'hexagon';
    if (b.startsWith('([') && b.endsWith('])')) return 'stadium';
    if (b.startsWith('[[') && b.endsWith(']]')) return 'subroutine';
    if (b.startsWith('([') && b.endsWith('])')) return 'circle';
    if (b.startsWith('(') && b.endsWith(')')) return 'circle';
    if (b.startsWith('>') && b.endsWith(']')) return 'asym';
    if (b.startsWith('{') && b.includes('/')) return 'odd';
    return 'rect';
}

function extractLabel(bracket) {
    if (!bracket) return '';
    const b = bracket.trim();
    return b.replace(/^[\[\(>{]{1,2}/, '').replace(/[\]}<){]{1,2}$/, '');
}

async function getLayoutFromRender(text) {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    container.style.visibility = 'hidden';
    document.body.appendChild(container);

    try {
        const result = await mermaid.render('mermaid-layout', text);
        const svgString = result && result.svg ? result.svg : result;
        if (!svgString) throw new Error('no svg returned');
        container.innerHTML = svgString;
        const layout = new Map();

        const nodeGroups = container.querySelectorAll('.node');
        nodeGroups.forEach(g => {
            try {
                const id = (g.id || '').replace(/-node$/, '');
                const transform = g.getAttribute('transform') || '';
                const match = transform.match(/translate\(([\d.]+),\s*([\d.]+)\)/);
                const x = match ? parseFloat(match[1]) : 0;
                const y = match ? parseFloat(match[2]) : 0;

                const shapeEl = g.querySelector('rect, circle, ellipse, polygon');
                let shape = 'rect';
                let w = 0, h = 0, r = 0;

                if (shapeEl) {
                    const tag = shapeEl.tagName.toLowerCase();
                    if (tag === 'circle') {
                        shape = 'circle';
                        const ra = shapeEl.getAttribute('r');
                        r = ra ? parseFloat(ra) : 20;
                    } else if (tag === 'rect' || tag === 'ellipse') {
                        shape = tag === 'rect' ? 'rect' : 'ellipse';
                        const wa = shapeEl.getAttribute('width');
                        const ha = shapeEl.getAttribute('height');
                        w = wa ? parseFloat(wa) : 40;
                        h = ha ? parseFloat(ha) : 40;
                    }
                }

                const textEl = g.querySelector('text');
                const label = textEl ? textEl.textContent : '';
                layout.set(id, { x, y, shape, w, h, r, label });
            } catch (e) {
                console.log('node parse error:', e.message);
            }
        });

        return layout;
    } catch (e) {
        console.log('mermaid.render error:', e.message);
        return new Map();
    } finally {
        document.body.removeChild(container);
    }
}

async function parseMermaid(text, canvasWidth, canvasHeight) {
    const nodes = new Map();
    const edges = [];

    const lines = text.split('\n');
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('graph')) continue;

        const arrowIdx = line.indexOf('-->');
        if (arrowIdx !== -1) {
            const before = line.slice(0, arrowIdx).trim();
            const after = line.slice(arrowIdx + 3).trim();

            let srcId, srcBracket, edgeLabel = '';

            const labelIdx = before.lastIndexOf(' -- ');
            if (labelIdx !== -1) {
                const srcPart = before.slice(0, labelIdx).trim();
                edgeLabel = before.slice(labelIdx + 4).trim();
                const srcMatch = srcPart.match(/^(\w+)\s*(.*)$/);
                if (srcMatch) {
                    srcId = srcMatch[1];
                    srcBracket = srcMatch[2].trim() || undefined;
                }
            } else {
                const srcMatch = before.match(/^(\w+)\s*(.*)$/);
                if (srcMatch) {
                    srcId = srcMatch[1];
                    srcBracket = srcMatch[2].trim() || undefined;
                }
            }

            const dstMatch = after.match(/^(\w+)\s*(.*)$/);
            const dstId = dstMatch ? dstMatch[1] : '';
            const dstBracket = dstMatch ? (dstMatch[2].trim() || undefined) : undefined;

            if (srcId) {
                const existing = nodes.get(srcId);
                if (existing) {
                    if (srcBracket) {
                        existing.label = extractLabel(srcBracket) || existing.label;
                        existing.shape = detectShape(srcBracket) || existing.shape;
                    }
                } else {
                    nodes.set(srcId, { id: srcId, label: extractLabel(srcBracket || ''), shape: detectShape(srcBracket || '') });
                }
            }
            if (dstId) {
                const existing = nodes.get(dstId);
                if (existing) {
                    if (dstBracket) {
                        existing.label = extractLabel(dstBracket) || existing.label;
                        existing.shape = detectShape(dstBracket) || existing.shape;
                    }
                } else {
                    nodes.set(dstId, { id: dstId, label: extractLabel(dstBracket || ''), shape: detectShape(dstBracket || '') });
                }
            }
            edges.push({ source: srcId, target: dstId, label: edgeLabel });
            continue;
        }

        const nodeMatch = line.match(/^(\w+)\s*((?:\[[^\]]*\]|\([^\)]*\)|{{\s*[^}]*\s*}}|\[\[[^\]]*\]\]|\(\[[^\]]*\]\)|>\s*[^\]]*\]|\{[^/]+\/|\{\{?\s*[^}]*\s*\}}?))?/);
        if (nodeMatch) {
            const [, id, bracket] = nodeMatch;
            const existing = nodes.get(id);
            if (existing) {
                if (bracket) {
                    existing.label = extractLabel(bracket) || existing.label;
                    existing.shape = detectShape(bracket) || existing.shape;
                }
            } else {
                nodes.set(id, { id, label: extractLabel(bracket || ''), shape: detectShape(bracket || '') });
            }
        }
    }

    if (typeof mermaid !== 'undefined' && mermaid.render) {
        try {
            const renderLayout = await getLayoutFromRender(text);

            if (renderLayout.size > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const pos of renderLayout.values()) {
                    if (!pos) continue;
                    minX = Math.min(minX, pos.x);
                    minY = Math.min(minY, pos.y);
                    maxX = Math.max(maxX, pos.x);
                    maxY = Math.max(maxY, pos.y);
                }
                const cx = canvasWidth / 2;
                const cy = canvasHeight / 2;
                const layoutCx = (minX + maxX) / 2;
                const layoutCy = (minY + maxY) / 2;
                const offsetX = cx - layoutCx;
                const offsetY = cy - layoutCy;

                for (const [id, pos] of renderLayout) {
                    if (!pos) continue;
                    const node = nodes.get(id);
                    if (node) {
                        node.x = pos.x + offsetX;
                        node.y = pos.y + offsetY;
                        node.shape = pos.shape || node.shape;
                        node.label = pos.label || node.label;
                        if (pos.shape === 'circle') {
                            node.width = (pos.r || 20) * 2;
                            node.height = (pos.r || 20) * 2;
                        } else {
                            node.width = pos.w || 100;
                            node.height = pos.h || 44;
                        }
                        node.hitboxRadius = Math.max(node.width, node.height) * 0.8;
                        node.mass = Math.max(node.width, node.height) / 2;
                    }
                }
            }
        } catch (e) {
            console.log('layout apply error:', e.message);
        }
    }

    return { nodes: Array.from(nodes.values()), edges };
}

class Node {
    constructor(id, label, x, y, width, height, shape) {
        this.id = id;
        this.label = label;
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.shape = shape || 'rect';
        this.hitboxRadius = Math.max(width, height) * 0.4;
        this.color = '#00aaff';
        this.vx = 0;
        this.vy = 0;
        this.mass = Math.max(width, height) / 2;
    }
}

class GraphVisualizer {
    constructor(canvasId) {
        const existing = document.getElementById(canvasId);
        if (existing) existing.remove();

        this.canvas = document.createElement('canvas');
        document.body.appendChild(this.canvas);
        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.zIndex = '-1';
        this.canvas.style.pointerEvents = 'auto';
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.nodes = [];
        this.edges = [];
        this.nodeMap = new Map();

        this.draggedNode = null;
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        window.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    async loadGraph(mermaidText) {
        const { nodes, edges } = await parseMermaid(mermaidText, this.canvas.width, this.canvas.height);

        this.nodes = [];
        this.nodeMap = new Map();

        const targets = new Set(edges.map(e => e.target));
        const roots = nodes.filter(nd => !targets.has(nd.id));
        const nonRoots = nodes.filter(nd => targets.has(nd.id));

        const cx = this.canvas.width / 2;
        const topY = 80;
        const gap = Math.max(60, this.canvas.width / Math.max(roots.length + 1, 1));

        const ctx = this.ctx;
        const fontSize = 16;
        ctx.font = fontSize + 'px sans-serif';
        let maxTextWidth = 40;
        nodes.forEach(nd => {
            const w = ctx.measureText(nd.label).width;
            if (w > maxTextWidth) maxTextWidth = w;
        });
        const fixedWidth = maxTextWidth + 40;
        const fixedHeight = 44;

        roots.forEach((nd, i) => {
            const x = gap * (i + 1);
            const y = topY;
            const node = new Node(nd.id, nd.label, x, y, fixedWidth, fixedHeight, nd.shape);
            this.nodes.push(node);
            this.nodeMap.set(nd.id, node);
        });

        const childrenMap = new Map();
        for (const e of edges) {
            if (!childrenMap.has(e.source)) childrenMap.set(e.source, []);
            childrenMap.get(e.source).push(e.target);
        }

        const parentNodeById = new Map(this.nodeMap);

        nonRoots.forEach(nd => {
            const parents = edges.filter(e => e.target === nd.id).map(e => e.source);

            let x = cx;
            let y = topY + 150;

            if (parents.length > 0) {
                const parent = parentNodeById.get(parents[0]);
                const siblings = childrenMap.get(parents[0]) || [];
                const siblingIndex = siblings.indexOf(nd.id);
                const spread = fixedWidth + 40;
                const centerOffset = (siblingIndex - (siblings.length - 1) / 2) * spread;
                if (parent) {
                    x = parent.x + centerOffset;
                    y = parent.y + fixedHeight + 40;
                } else {
                    x = cx + centerOffset;
                }
            } else if (nd.x != null && nd.y != null) {
                x = nd.x;
                y = nd.y;
            }

            const node = new Node(nd.id, nd.label, x, y, fixedWidth, fixedHeight, nd.shape);
            this.nodes.push(node);
            this.nodeMap.set(nd.id, node);
            parentNodeById.set(nd.id, node);
        });

        this.edges = edges.map(e => ({
            a: this.nodeMap.get(e.source),
            b: this.nodeMap.get(e.target),
            label: e.label,
        }));
    }

    applyPhysics(dt) {
        const friction = 0.98;
        const bounce = 0.9;
        const springK = 2.0;
        const dampingC = 0.5;
        const restLength = 100;

        for (const e of this.edges) {
            const a = e.a, b = e.b;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
            const extension = dist - restLength;

            const nx = dx / dist;
            const ny = dy / dist;

            const springForce = -springK * extension;

            const relVx = b.vx - a.vx;
            const relVy = b.vy - a.vy;
            const velAlongSpring = relVx * nx + relVy * ny;
            const dampingForce = -dampingC * velAlongSpring;

            const totalForce = springForce + dampingForce;

            const fx = nx * totalForce;
            const fy = ny * totalForce;

            if (a !== this.draggedNode) {
                a.vx -= fx * dt / a.mass;
                a.vy -= fy * dt / a.mass;
            }
            if (b !== this.draggedNode) {
                b.vx += fx * dt / b.mass;
                b.vy += fy * dt / b.mass;
            }
        }

        for (let i = 0; i < this.nodes.length; i++) {
            const a = this.nodes[i];
            for (let j = i + 1; j < this.nodes.length; j++) {
                const b = this.nodes[j];
                if (a === this.draggedNode && b === this.draggedNode) continue;

                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
                const minDist = a.hitboxRadius + b.hitboxRadius;

                if (dist < minDist) {
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const overlap = minDist - dist;

                    const totalMass = a.mass + b.mass;
                    const moveA = overlap * (b.mass / totalMass);
                    const moveB = overlap * (a.mass / totalMass);

                    if (a !== this.draggedNode) {
                        a.x -= nx * moveA;
                        a.y -= ny * moveA;
                    }
                    if (b !== this.draggedNode) {
                        b.x += nx * moveB;
                        b.y += ny * moveB;
                    }

                    const relVx = b.vx - a.vx;
                    const relVy = b.vy - a.vy;
                    const velAlongNormal = relVx * nx + relVy * ny;

                    if (velAlongNormal < 0) {
                        const restitution = 0.8;
                        const j = -(1 + restitution) * velAlongNormal;
                        const impulse = j / (1 / a.mass + 1 / b.mass);

                        const ix = nx * impulse;
                        const iy = ny * impulse;

                        if (a !== this.draggedNode) {
                            a.vx -= ix / a.mass;
                            a.vy -= iy / a.mass;
                        }
                        if (b !== this.draggedNode) {
                            b.vx += ix / b.mass;
                            b.vy += iy / b.mass;
                        }
                    }
                }
            }
        }

        for (const n of this.nodes) {
            if (n === this.draggedNode) continue;
            n.vx *= friction;
            n.vy *= friction;
            n.x += n.vx * dt;
            n.y += n.vy * dt;

            const halfW = n.width / 2;
            const halfH = n.height / 2;

            const floor = this.canvas.height - halfH;
            if (n.y > floor) {
                n.y = floor;
                n.vy *= -bounce;
            }
            const ceiling = halfH;
            if (n.y < ceiling) {
                n.y = ceiling;
                n.vy *= -bounce;
            }
            const right = this.canvas.width - halfW;
            if (n.x > right) {
                n.x = right;
                n.vx *= -bounce;
            }
            const left = halfW;
            if (n.x < left) {
                n.x = left;
                n.vx *= -bounce;
            }
        }
    }

    getNodeAt(x, y) {
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const n = this.nodes[i];
            const dx = n.x - x;
            const dy = n.y - y;
            if (dx * dx + dy * dy <= n.hitboxRadius * n.hitboxRadius) return n;
        }
        return null;
    }

    onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const n = this.getNodeAt(x, y);
        if (n) {
            this.draggedNode = n;
            n.vx = 0;
            n.vy = 0;
        }
    }

    onMouseMove(e) {
        if (!this.draggedNode) return;
        const rect = this.canvas.getBoundingClientRect();
        this.draggedNode.x = e.clientX - rect.left;
        this.draggedNode.y = e.clientY - rect.top;
    }

    onMouseUp() {
        this.draggedNode = null;
    }

    draw() {
        const ctx = this.ctx;
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const drawArrowhead = (x, y, angle) => {
            const size = 12;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-size, -size / 2);
            ctx.lineTo(-size, size / 2);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();
        };

        for (const e of this.edges) {
            const a = e.a, b = e.b;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
            const nx = dx / dist;
            const ny = dy / dist;

            const halfBW = b.width / 2;
            const halfBH = b.height / 2;
            const endX = b.x - nx * Math.max(halfBW, b.hitboxRadius * 0.5);
            const endY = b.y - ny * Math.max(halfBH, b.hitboxRadius * 0.5);

            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(endX, endY);
            ctx.strokeStyle = '#00aaff';
            ctx.lineWidth = 3;
            ctx.stroke();

            drawArrowhead(endX, endY, Math.atan2(dy, dx));
        }

        for (const n of this.nodes) {
            ctx.save();
            ctx.translate(n.x, n.y);

            if (n.shape === 'circle') {
                const r = Math.min(n.width, n.height) / 2;
                ctx.beginPath();
                ctx.arc(0, 0, r, 0, Math.PI * 2);
            } else if (n.shape === 'rect' || n.shape === 'stadium' || n.shape === 'subroutine' || n.shape === 'asym' || n.shape === 'odd') {
                ctx.beginPath();
                ctx.roundRect(-n.width / 2, -n.height / 2, n.width, n.height, n.height * 0.25);
            } else if (n.shape === 'hexagon') {
                const r = Math.min(n.width, n.height) / 2;
                ctx.beginPath();
                for (let i = 0; i < 6; i++) {
                    const angle = (i * Math.PI) / 3;
                    ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
                }
                ctx.closePath();
            }

            ctx.fillStyle = n.color;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '16px sans-serif';
            ctx.fillText(n.label, 0, 0);

            ctx.restore();
        }

        // Edge labels drawn last so they render on top
        for (const e of this.edges) {
            if (!e.label || !e.label.trim()) continue;
            const a = e.a, b = e.b;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '14px sans-serif';
            ctx.fillText(e.label, mx, my + 2);
            ctx.restore();
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const dt = 0.016;
        this.applyPhysics(dt);
        this.draw();
    }
}

window.onload = async function() {
    const viz = new GraphVisualizer('canvas');
    await viz.loadGraph(mermaidGraph);
    viz.animate();

    document.getElementById('load').addEventListener('click', async () => {
        const text = document.getElementById('mermaid').value;
        await viz.loadGraph(text);
    });
};
