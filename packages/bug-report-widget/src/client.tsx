"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { severityOptions, type Severity } from "./shared.js";

export type BugReportWidgetProps = {
  /** The server route created by `thread-catch init` */
  endpoint?: string;
  /** Product name shown in the panel heading */
  productName?: string;
};

type PanelPosition = { left: number; top: number };
type HoverBox = { left: number; top: number; width: number; height: number };

const style = `
@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap");
@keyframes brw-slideIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes brw-fadeIn{from{opacity:0}to{opacity:1}}
.brw-root{font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;color:#dbdee1;line-height:1.35}
.brw-launch{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:48px;height:48px;border:0;border-radius:50%;background:#5865f2;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.35);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,transform .15s}
.brw-launch:hover{background:#4752c4;transform:scale(1.05)}.brw-launch:active{transform:scale(.97)}
.brw-launch:focus-visible,.brw-panel button:focus-visible,.brw-panel input:focus-visible,.brw-panel textarea:focus-visible,.brw-panel select:focus-visible{outline:2px solid #5865f2;outline-offset:2px}
.brw-bug{display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,.25))}
.brw-panel{position:fixed;right:20px;bottom:80px;z-index:2147483000;width:min(372px,calc(100vw - 28px));overflow:hidden;border:1px solid #3f4147;border-radius:8px;background:#2b2d31;box-shadow:0 8px 24px rgba(0,0,0,.4);animation:brw-slideIn .2s ease-out}
.brw-head{display:flex;align-items:center;justify-content:space-between;padding:13px 14px;background:#1e1f22;border-bottom:2px solid #5865f2;cursor:grab;touch-action:none}.brw-head:active{cursor:grabbing}.brw-head strong{font-size:14px;font-weight:700;color:#f2f3f5}.brw-icon{width:28px;height:28px;border:0;border-radius:4px;background:transparent;color:#b5bac1;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;transition:color .15s,background .15s}.brw-icon:hover{color:#f2f3f5;background:rgba(255,255,255,.08)}
.brw-form{display:grid;gap:11px;padding:14px}.brw-label{display:grid;gap:5px;font-size:12px;font-weight:700;color:#b5bac1;text-transform:uppercase;letter-spacing:.3px}.brw-input,.brw-textarea,.brw-select{box-sizing:border-box;width:100%;border:1px solid #3f4147;border-radius:4px;background:#1e1f22;color:#dbdee1;font:inherit;font-size:14px;padding:8px 10px;transition:border-color .15s}.brw-input::placeholder,.brw-textarea::placeholder{color:#6d6f78}.brw-input:focus,.brw-textarea:focus,.brw-select:focus{border-color:#5865f2;outline:none;box-shadow:0 0 0 1px #5865f2}.brw-textarea{min-height:96px;resize:vertical}.brw-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.brw-select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23b5bac1' d='M2 4l4 4 4-4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;padding-right:28px}
.brw-selector{display:flex;gap:7px;align-items:center}.brw-selector code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;border:1px solid #3f4147;border-radius:4px;background:#1e1f22;padding:7px 8px;color:#b5bac1;font-size:11px;font-family:"Consolas","Andale Mono","Lucida Console",monospace}.brw-secondary,.brw-submit{border:0;border-radius:4px;padding:9px 11px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:background .15s,opacity .15s}.brw-secondary{background:#4e5058;color:#dbdee1}.brw-secondary:hover{background:#6d6f78;color:#fff}.brw-submit{background:#5865f2;color:#fff}.brw-submit:hover{background:#4752c4}.brw-submit:disabled,.brw-secondary:disabled{cursor:wait;opacity:.5}.brw-status{margin:0;font-size:12px;color:#b5bac1}.brw-status[data-error="true"]{color:#ed4245}.brw-cancel{color:#5865f2;background:transparent;border:0;padding:0;font:inherit;font-size:12px;text-align:left;cursor:pointer;transition:color .15s}.brw-cancel:hover{color:#7289da}
.brw-severity{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;flex-shrink:0}.brw-severity-low{background:#57f287}.brw-severity-medium{background:#fee75c}.brw-severity-high{background:#f0b232}.brw-severity-critical{background:#ed4245}
.brw-highlight{position:fixed;z-index:2147482999;border:2px solid #5865f2;background:rgba(88,101,242,.12);pointer-events:none}.brw-picking{cursor:crosshair!important}
@media(max-width:480px){.brw-panel{right:14px;bottom:76px}.brw-launch{right:14px;bottom:14px}}
`;

function escapeIdentifier(value: string) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function selectorFor(element: HTMLElement) {
  if (element.id) return `#${escapeIdentifier(element.id)}`;

  const parts: string[] = [];
  let node: HTMLElement | null = element;
  while (node && node !== document.body && parts.length < 5) {
    const tag = node.tagName.toLowerCase();
    const stableClass = Array.from(node.classList).find((item) => /^[a-z][a-z0-9_-]{1,40}$/i.test(item));
    if (stableClass) {
      parts.unshift(`${tag}.${escapeIdentifier(stableClass)}`);
      break;
    }
    const siblings = node.parentElement ? Array.from(node.parentElement.children).filter((child) => child.tagName === node!.tagName) : [];
    const index = siblings.indexOf(node) + 1;
    parts.unshift(`${tag}:nth-of-type(${index})`);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

export function BugReportWidget({ endpoint = "/api/bug-report", productName = "Bug report" }: BugReportWidgetProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [selector, setSelector] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [hoverBox, setHoverBox] = useState<HoverBox | null>(null);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const [drag, setDrag] = useState<{ pointerX: number; pointerY: number; left: number; top: number } | null>(null);
  const [status, setStatus] = useState<{ message: string; error: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!selecting) return;

    const move = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || rootRef.current?.contains(target)) return;
      const rect = target.getBoundingClientRect();
      setHoverBox({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    };
    const choose = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || rootRef.current?.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      setSelector(selectorFor(target));
      setSelecting(false);
      setHoverBox(null);
    };
    document.documentElement.classList.add("brw-picking");
    document.addEventListener("pointermove", move, true);
    document.addEventListener("click", choose, true);
    return () => {
      document.documentElement.classList.remove("brw-picking");
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("click", choose, true);
    };
  }, [selecting]);

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const width = Math.min(372, window.innerWidth - 28);
      const nextLeft = Math.max(14, Math.min(window.innerWidth - width - 14, drag.left + event.clientX - drag.pointerX));
      const nextTop = Math.max(14, Math.min(window.innerHeight - 160, drag.top + event.clientY - drag.pointerY));
      setPosition({ left: nextLeft, top: nextTop });
    };
    const stop = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [drag]);

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    const panel = event.currentTarget.parentElement;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPosition({ left: rect.left, top: rect.top });
    setDrag({ pointerX: event.clientX, pointerY: event.clientY, left: rect.left, top: rect.top });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description, severity, selector, pageUrl: window.location.href, userAgent: navigator.userAgent })
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Could not send the report.");
      setTitle("");
      setDescription("");
      setSelector("");
      setStatus({ message: "Sent to your team.", error: false });
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : "Could not send the report.", error: true });
    } finally {
      setSubmitting(false);
    }
  }

  const panelStyle: CSSProperties = position ? { left: position.left, top: position.top, right: "auto", bottom: "auto" } : {};

  return (
    <div className="brw-root" ref={rootRef}>
      <style>{style}</style>
      {hoverBox && <div className="brw-highlight" style={hoverBox} aria-hidden="true" />}
      {open && (
        <section className="brw-panel" style={panelStyle} aria-label="Submit a bug report">
          <div className="brw-head" onPointerDown={startDrag}>
            <strong>{productName}</strong>
            <button className="brw-icon" type="button" aria-label="Close bug report" onClick={() => setOpen(false)}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
          </div>
          <form className="brw-form" onSubmit={submit}>
            <label className="brw-label">What happened?<input className="brw-input" value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={120} required placeholder="Write a short summary..." /></label>
            <label className="brw-label">Details<textarea className="brw-textarea" value={description} onChange={(event) => setDescription(event.target.value)} minLength={10} maxLength={4000} required placeholder="What did you expect, and what happened instead?" /></label>
            <div className="brw-row">
              <label className="brw-label"><span style={{display:"flex",alignItems:"center",gap:0}}><span className={`brw-severity brw-severity-${severity}`} />Severity</span><select className="brw-select" value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}>{severityOptions.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></label>
              <div className="brw-label">Affected element<div className="brw-selector"><code title={selector || "No element selected"}>{selector || "None"}</code><button className="brw-secondary" type="button" onClick={() => { setStatus(null); setSelecting(true); }}>{selecting ? "Click page" : "Select"}</button></div></div>
            </div>
            {selecting && <button className="brw-cancel" type="button" onClick={() => setSelecting(false)}>Cancel element selection</button>}
            {status && <p className="brw-status" data-error={status.error}>{status.message}</p>}
            <button className="brw-submit" type="submit" disabled={submitting}>{submitting ? "Sending..." : "Send report"}</button>
          </form>
        </section>
      )}
      <button className="brw-launch" type="button" aria-label="Report a bug" onClick={() => { setOpen((value) => !value); setStatus(null); }}>
        <svg className="brw-bug" width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9.3 6.4C7.9 5 7 3.5 6.8 1.9" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M14.7 6.4C16.1 5 17 3.5 17.2 1.9" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M5.8 12.6C3.8 11.5 2.3 12 1.6 13.5" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M6.2 15.4C4.3 14.9 2.8 15.4 2.2 16.9" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M6.6 18.2C4.9 18.2 3.4 18.8 2.7 20" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M18.2 12.6C20.2 11.5 21.7 12 22.4 13.5" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M17.8 15.4C19.7 14.9 21.2 15.4 21.8 16.9" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M17.4 18.2C19.1 18.2 20.6 18.8 21.3 20" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="12" cy="5.8" r="2.8" fill="#0b0b0d" />
          <ellipse cx="12" cy="14.6" rx="8" ry="6.6" fill="#ed4245" />
          <path d="M12 8v13.2" stroke="#0b0b0d" strokeWidth="1.3" />
          <circle cx="9.6" cy="12.4" r="1.3" fill="#0b0b0d" />
          <circle cx="14.4" cy="12.4" r="1.3" fill="#0b0b0d" />
          <circle cx="12" cy="17.6" r="1.3" fill="#0b0b0d" />
          <circle cx="8.1" cy="16.4" r="1" fill="#0b0b0d" />
          <circle cx="15.9" cy="16.4" r="1" fill="#0b0b0d" />
        </svg>
      </button>
    </div>
  );
}

export type { Severity } from "./shared.js";
