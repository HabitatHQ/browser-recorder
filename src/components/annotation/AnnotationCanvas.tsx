import { cn } from "@/lib/utils";
import { ArrowUpRight, Check, EyeOff, Square, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type ToolType = "arrow" | "rect" | "blur";

interface Point {
  x: number;
  y: number;
}

interface ArrowLayer {
  kind: "arrow";
  start: Point;
  end: Point;
  color: string;
}

interface RectLayer {
  kind: "rect";
  start: Point;
  end: Point;
  color: string;
}

interface BlurLayer {
  kind: "blur";
  start: Point;
  end: Point;
}

type Layer = ArrowLayer | RectLayer | BlurLayer;

const COLORS = [
  { value: "#ef4444", label: "Red" },
  { value: "#eab308", label: "Yellow" },
  { value: "#000000", label: "Black" },
];

const TOOLBAR_WIDTH = 56;

function drawArrow(ctx: CanvasRenderingContext2D, start: Point, end: Point, color: string): void {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);
  const headLen = 14;
  const lineWidth = 2.5;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(
    end.x - headLen * Math.cos(angle - Math.PI / 6),
    end.y - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    end.x - headLen * Math.cos(angle + Math.PI / 6),
    end.y - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRect(ctx: CanvasRenderingContext2D, start: Point, end: Point, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
  ctx.restore();
}

function drawBlur(
  ctx: CanvasRenderingContext2D,
  imageCanvas: HTMLCanvasElement,
  start: Point,
  end: Point
): void {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  if (w < 2 || h < 2) return;

  const scale = 10;
  const offscreen = document.createElement("canvas");
  offscreen.width = Math.max(1, Math.floor(w / scale));
  offscreen.height = Math.max(1, Math.floor(h / scale));
  const offCtx = offscreen.getContext("2d");
  if (!offCtx) return;
  offCtx.imageSmoothingEnabled = false;
  offCtx.drawImage(imageCanvas, x, y, w, h, 0, 0, offscreen.width, offscreen.height);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(offscreen, 0, 0, offscreen.width, offscreen.height, x, y, w, h);
  ctx.restore();
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  imageCanvas: HTMLCanvasElement
): void {
  if (layer.kind === "arrow") {
    drawArrow(ctx, layer.start, layer.end, layer.color);
  } else if (layer.kind === "rect") {
    drawRect(ctx, layer.start, layer.end, layer.color);
  } else {
    drawBlur(ctx, imageCanvas, layer.start, layer.end);
  }
}

export interface AnnotationCanvasProps {
  imageDataUrl: string;
  onDone: (annotatedBlob: Blob) => void;
  onCancel: () => void;
}

export function AnnotationCanvas({ imageDataUrl, onDone, onCancel }: AnnotationCanvasProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const backingRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [tool, setTool] = useState<ToolType>("arrow");
  const [color, setColor] = useState(COLORS[0].value);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [cancelPending, setCancelPending] = useState(false);

  const dragging = useRef(false);
  const dragStart = useRef<Point>({ x: 0, y: 0 });
  const currentTool = useRef<ToolType>("arrow");
  const currentColor = useRef(COLORS[0].value);
  const layersRef = useRef<Layer[]>([]);

  useEffect(() => {
    currentTool.current = tool;
  }, [tool]);

  useEffect(() => {
    currentColor.current = color;
  }, [color]);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  const redrawBacking = useCallback(() => {
    const img = imgRef.current;
    const canvas = backingRef.current;
    if (!img || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    for (const layer of layersRef.current) {
      drawLayer(ctx, layer, canvas);
    }
  }, []);

  const clearOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  // useLayoutEffect fires synchronously after the DOM commit, guaranteeing that
  // backingRef/overlayRef are non-null before we assign canvas dimensions.
  useLayoutEffect(() => {
    if (!imgSize) return;
    const img = imgRef.current;
    const backing = backingRef.current;
    const overlay = overlayRef.current;
    if (!img || !backing || !overlay) return;

    backing.width = imgSize.w;
    backing.height = imgSize.h;
    overlay.width = imgSize.w;
    overlay.height = imgSize.h;

    const ctx = backing.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    setImgLoaded(true);
  }, [imgSize]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: layers is a trigger dep; redrawBacking reads layersRef.current to avoid stale closure
  useEffect(() => {
    if (!imgLoaded) return;
    redrawBacking();
  }, [layers, imgLoaded, redrawBacking]);

  function getPos(e: React.MouseEvent<HTMLCanvasElement>): Point {
    const canvas = overlayRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    dragging.current = true;
    dragStart.current = getPos(e);
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragging.current) return;
    const overlay = overlayRef.current;
    const backing = backingRef.current;
    const img = imgRef.current;
    if (!overlay || !backing || !img) return;

    const pos = getPos(e);
    const overlayCtx = overlay.getContext("2d");
    if (!overlayCtx) return;
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

    const t = currentTool.current;
    if (t === "arrow") {
      drawArrow(overlayCtx, dragStart.current, pos, currentColor.current);
    } else if (t === "rect") {
      drawRect(overlayCtx, dragStart.current, pos, currentColor.current);
    } else {
      const backCtx = backing.getContext("2d");
      if (!backCtx) return;
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = backing.width;
      tempCanvas.height = backing.height;
      const tempCtx = tempCanvas.getContext("2d") as CanvasRenderingContext2D;
      tempCtx.drawImage(backing, 0, 0);
      drawBlur(overlayCtx, tempCanvas, dragStart.current, pos);
      backCtx.clearRect(0, 0, backing.width, backing.height);
      backCtx.drawImage(img, 0, 0);
      for (const layer of layersRef.current) drawLayer(backCtx, layer, tempCanvas);
    }
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    const pos = getPos(e);
    clearOverlay();

    const t = currentTool.current;
    let newLayer: Layer;

    if (t === "arrow") {
      newLayer = { kind: "arrow", start: dragStart.current, end: pos, color: currentColor.current };
    } else if (t === "rect") {
      newLayer = { kind: "rect", start: dragStart.current, end: pos, color: currentColor.current };
    } else {
      newLayer = { kind: "blur", start: dragStart.current, end: pos };
    }

    setLayers((prev) => [...prev, newLayer]);
  }

  function handleUndo() {
    setLayers((prev) => prev.slice(0, -1));
  }

  function handleClear() {
    setLayers([]);
  }

  function handleDone() {
    const img = imgRef.current;
    if (!img) return;
    const offscreen = document.createElement("canvas");
    offscreen.width = img.naturalWidth;
    offscreen.height = img.naturalHeight;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);

    const scaleX = img.naturalWidth / (imgSize?.w ?? img.naturalWidth);
    const scaleY = img.naturalHeight / (imgSize?.h ?? img.naturalHeight);

    for (const layer of layersRef.current) {
      if (layer.kind === "arrow") {
        drawArrow(
          ctx,
          { x: layer.start.x * scaleX, y: layer.start.y * scaleY },
          { x: layer.end.x * scaleX, y: layer.end.y * scaleY },
          layer.color
        );
      } else if (layer.kind === "rect") {
        drawRect(
          ctx,
          { x: layer.start.x * scaleX, y: layer.start.y * scaleY },
          { x: layer.end.x * scaleX, y: layer.end.y * scaleY },
          layer.color
        );
      } else {
        drawBlur(
          ctx,
          offscreen,
          { x: layer.start.x * scaleX, y: layer.start.y * scaleY },
          { x: layer.end.x * scaleX, y: layer.end.y * scaleY }
        );
      }
    }

    offscreen.toBlob((blob) => {
      if (blob) onDone(blob);
    }, "image/png");
  }

  function onImgLoad() {
    const img = imgRef.current;
    if (!img) return;
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
  }

  const displaySize = imgSize
    ? (() => {
        const maxW = window.innerWidth - TOOLBAR_WIDTH - 8;
        const maxH = window.innerHeight - 16;
        const ratio = Math.min(maxW / imgSize.w, maxH / imgSize.h, 1);
        return { w: Math.floor(imgSize.w * ratio), h: Math.floor(imgSize.h * ratio) };
      })()
    : null;

  return (
    <div className="fixed inset-0 flex bg-black/80" ref={containerRef}>
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <div
          className="relative"
          style={displaySize ? { width: displaySize.w, height: displaySize.h } : undefined}
        >
          <img
            ref={imgRef}
            src={imageDataUrl}
            alt="screenshot"
            className="invisible absolute"
            onLoad={onImgLoad}
          />
          {displaySize && (
            <>
              <canvas
                ref={backingRef}
                className="absolute inset-0"
                style={{ width: displaySize.w, height: displaySize.h }}
              />
              <canvas
                ref={overlayRef}
                className="absolute inset-0 cursor-crosshair"
                style={{ width: displaySize.w, height: displaySize.h }}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
              />
            </>
          )}
        </div>
      </div>

      <div
        className="flex flex-col items-center gap-1 bg-background py-2"
        style={{ width: TOOLBAR_WIDTH }}
      >
        <ToolBtn
          active={tool === "arrow"}
          onClick={() => setTool("arrow")}
          title="Arrow"
          label="Arrow"
        >
          <ArrowUpRight className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn active={tool === "rect"} onClick={() => setTool("rect")} title="Rect" label="Rect">
          <Square className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn
          active={tool === "blur"}
          onClick={() => setTool("blur")}
          title="Redact"
          label="Redact"
        >
          <EyeOff className="h-4 w-4" />
        </ToolBtn>

        <div className="my-1 w-full border-t border-border" />

        {COLORS.map((c) => (
          <button
            type="button"
            key={c.value}
            title={c.label}
            className={cn(
              "h-5 w-5 rounded-full border-2 transition-transform",
              color === c.value ? "border-foreground scale-110" : "border-transparent"
            )}
            style={{ backgroundColor: c.value }}
            onClick={() => setColor(c.value)}
          />
        ))}

        <div className="my-1 w-full border-t border-border" />

        <ToolBtn onClick={handleUndo} title="Undo" label="Undo">
          <Undo2 className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn onClick={handleClear} title="Clear all" label="Clear">
          <Trash2 className="h-4 w-4" />
        </ToolBtn>

        <div className="my-1 w-full border-t border-border" />

        <button
          type="button"
          title="Done"
          className="flex w-full flex-col items-center gap-0.5 rounded-md bg-green-600 py-1 text-white hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 transition-colors"
          onClick={handleDone}
        >
          <Check className="h-4 w-4" />
          <span className="text-[9px] leading-none">Done</span>
        </button>

        {cancelPending ? (
          <div className="flex w-full flex-col items-center gap-1 px-1 pt-1">
            <span className="text-[9px] text-muted-foreground text-center leading-tight">
              Discard?
            </span>
            <button
              type="button"
              className="w-full rounded bg-destructive py-0.5 text-[10px] text-destructive-foreground hover:bg-destructive/90 transition-colors"
              onClick={onCancel}
            >
              Yes
            </button>
            <button
              type="button"
              className="w-full rounded py-0.5 text-[10px] hover:bg-muted transition-colors"
              onClick={() => setCancelPending(false)}
            >
              No
            </button>
          </div>
        ) : (
          <ToolBtn onClick={() => setCancelPending(true)} title="Cancel" label="Cancel">
            <X className="h-4 w-4" />
          </ToolBtn>
        )}
      </div>
    </div>
  );
}

function ToolBtn({
  active,
  onClick,
  title,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "flex w-full flex-col items-center gap-0.5 rounded-md py-1 transition-colors",
        active ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
      )}
    >
      {children}
      {label && <span className="text-[9px] leading-none">{label}</span>}
    </button>
  );
}
