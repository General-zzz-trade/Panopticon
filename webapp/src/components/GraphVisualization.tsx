import { useRef, useEffect, useState, useCallback } from 'react';

interface GraphNode {
  id: string;
  type: string;
  value: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  confidence: number;
  pinned?: boolean;
}

interface GraphEdge {
  sourceId: string;
  targetId: string;
  type: string;
  confidence: number;
}

interface Props {
  entities: { id: string; type: string; value: string; confidence: number }[];
  relations: { sourceId: string; targetId: string; type: string; confidence: number }[];
  width?: number;
  height?: number;
}

const TYPE_COLORS: Record<string, string> = {
  domain: '#00ff88', ip: '#06b6d4', email: '#f59e0b', username: '#a855f7',
  organization: '#ec4899', port: '#64748b', nameserver: '#22d3ee', technology: '#84cc16',
  certificate: '#f97316', registrar: '#6366f1', country: '#14b8a6', hosting: '#e879f9',
  url: '#38bdf8', person: '#fb923c', asn: '#34d399',
};

export default function GraphVisualization({ entities, relations, width: propWidth, height: propHeight }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ w: propWidth || 800, h: propHeight || 500 });
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const animRef = useRef<number>(0);
  const [dragNode, setDragNode] = useState<string | null>(null);
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const [filter, setFilter] = useState<string>('');
  const offsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);

  // Initialize nodes with positions
  useEffect(() => {
    const cx = dimensions.w / 2;
    const cy = dimensions.h / 2;
    nodesRef.current = entities.map((e, i) => ({
      ...e,
      x: cx + (Math.random() - 0.5) * dimensions.w * 0.6,
      y: cy + (Math.random() - 0.5) * dimensions.h * 0.6,
      vx: 0, vy: 0,
    }));
    edgesRef.current = relations.map(r => ({ ...r }));
  }, [entities, relations, dimensions]);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Force simulation + render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    const { w, h } = dimensions;

    const tick = () => {
      // Force simulation
      const alpha = 0.3;

      // Repulsion between nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const force = 800 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          if (!nodes[i].pinned) { nodes[i].vx -= fx; nodes[i].vy -= fy; }
          if (!nodes[j].pinned) { nodes[j].vx += fx; nodes[j].vy += fy; }
        }
      }

      // Attraction along edges
      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      for (const edge of edges) {
        const s = nodeMap.get(edge.sourceId);
        const t = nodeMap.get(edge.targetId);
        if (!s || !t) continue;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = (dist - 120) * 0.01;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!s.pinned) { s.vx += fx; s.vy += fy; }
        if (!t.pinned) { t.vx -= fx; t.vy -= fy; }
      }

      // Center gravity
      for (const node of nodes) {
        if (node.pinned) continue;
        node.vx += (w / 2 - node.x) * 0.001;
        node.vy += (h / 2 - node.y) * 0.001;
        node.vx *= 0.85;
        node.vy *= 0.85;
        node.x += node.vx * alpha;
        node.y += node.vy * alpha;
        node.x = Math.max(20, Math.min(w - 20, node.x));
        node.y = Math.max(20, Math.min(h - 20, node.y));
      }

      // Render
      ctx.save();
      ctx.clearRect(0, 0, w, h);
      ctx.translate(offsetRef.current.x, offsetRef.current.y);
      ctx.scale(scaleRef.current, scaleRef.current);

      // Draw edges
      for (const edge of edges) {
        const s = nodeMap.get(edge.sourceId);
        const t = nodeMap.get(edge.targetId);
        if (!s || !t) continue;
        if (filter && !s.type.includes(filter) && !t.type.includes(filter)) continue;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = `rgba(255,255,255,${0.06 + edge.confidence * 0.1})`;
        ctx.lineWidth = 0.5 + edge.confidence;
        ctx.stroke();
      }

      // Draw nodes
      for (const node of nodes) {
        if (filter && !node.type.includes(filter) && !node.value.includes(filter)) continue;
        const color = TYPE_COLORS[node.type] || '#64748b';
        const r = 4 + node.confidence * 4;
        const isHover = hoverNode?.id === node.id;

        // Glow
        if (isHover) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
          ctx.fillStyle = color + '30';
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Label
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `${isHover ? 11 : 9}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        const label = node.value.length > 20 ? node.value.slice(0, 18) + '..' : node.value;
        ctx.fillText(label, node.x, node.y + r + 12);
      }

      ctx.restore();
      animRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => cancelAnimationFrame(animRef.current);
  }, [dimensions, filter, hoverNode]);

  // Mouse interactions
  const findNode = useCallback((mx: number, my: number): GraphNode | null => {
    const s = scaleRef.current;
    const ox = offsetRef.current.x;
    const oy = offsetRef.current.y;
    for (const node of nodesRef.current) {
      const dx = (node.x * s + ox) - mx;
      const dy = (node.y * s + oy) - my;
      if (Math.sqrt(dx * dx + dy * dy) < 12) return node;
    }
    return null;
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const node = findNode(e.clientX - rect.left, e.clientY - rect.top);
    if (node) { setDragNode(node.id); node.pinned = true; }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (dragNode) {
      const node = nodesRef.current.find(n => n.id === dragNode);
      if (node) {
        node.x = (mx - offsetRef.current.x) / scaleRef.current;
        node.y = (my - offsetRef.current.y) / scaleRef.current;
      }
    } else {
      setHoverNode(findNode(mx, my));
    }
  };

  const handleMouseUp = () => {
    if (dragNode) {
      const node = nodesRef.current.find(n => n.id === dragNode);
      if (node) node.pinned = false;
      setDragNode(null);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    scaleRef.current = Math.max(0.3, Math.min(3, scaleRef.current * delta));
  };

  // Type legend
  const types = [...new Set(entities.map(e => e.type))].sort();

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[400px] bg-osint-bg rounded-lg border border-osint-border overflow-hidden">
      <canvas
        ref={canvasRef}
        width={dimensions.w}
        height={dimensions.h}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="cursor-crosshair"
        style={{ width: '100%', height: '100%' }}
      />

      {/* Legend */}
      <div className="absolute top-3 left-3 bg-osint-panel/90 border border-osint-border rounded-lg p-2 max-h-48 overflow-y-auto">
        <p className="text-[9px] text-osint-muted tracking-wider mb-1">ENTITY TYPES</p>
        {types.map(t => (
          <button key={t} onClick={() => setFilter(f => f === t ? '' : t)}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] font-mono w-full rounded transition ${filter === t ? 'bg-white/10' : 'hover:bg-white/5'}`}>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: TYPE_COLORS[t] || '#64748b' }} />
            <span className="text-osint-text/70">{t}</span>
            <span className="ml-auto text-osint-muted">{entities.filter(e => e.type === t).length}</span>
          </button>
        ))}
        {filter && <button onClick={() => setFilter('')} className="text-[9px] text-osint-accent mt-1 w-full text-left px-1.5">Clear filter</button>}
      </div>

      {/* Hover tooltip */}
      {hoverNode && (
        <div className="absolute bottom-3 left-3 bg-osint-panel/95 border border-osint-border rounded-lg p-3 max-w-xs">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-3 h-3 rounded-full" style={{ background: TYPE_COLORS[hoverNode.type] || '#64748b' }} />
            <span className="text-xs font-mono text-osint-accent">{hoverNode.type}</span>
          </div>
          <p className="text-xs font-mono text-osint-text break-all">{hoverNode.value}</p>
          <p className="text-[10px] text-osint-muted mt-1">Confidence: {(hoverNode.confidence * 100).toFixed(0)}%</p>
        </div>
      )}

      {/* Stats */}
      <div className="absolute top-3 right-3 text-[10px] font-mono text-osint-muted bg-osint-panel/90 border border-osint-border rounded-lg px-2 py-1">
        {entities.length} nodes | {relations.length} edges
      </div>
    </div>
  );
}
