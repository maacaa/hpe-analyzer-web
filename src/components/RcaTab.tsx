import type { ReactNode } from "react";
import type { BugEntry, Playbook, RcaEntry, Summary } from "../types";
import { SevBadge } from "./ImlTab";

export function RcaTab({ model }: { model: Summary }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Root Cause Analysis</h3>
        <span className="muted">
          {model.rca.length} critical error type{model.rca.length === 1 ? "" : "s"} ·
          newest first
        </span>
      </div>
      {model.rca.length === 0 ? (
        <div className="empty">
          No critical events detected. This unit looks healthy.
        </div>
      ) : (
        <div className="rca-list">
          {model.rca.map((r, i) => (
            <RcaCard key={i} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function RcaCard({ r }: { r: RcaEntry }) {
  return (
    <div className="rca-card">
      <div className="rca-alarm">
        <SevBadge sev={r.severity} />
        {r.category && <span className={`rca-cat cat-${r.category}`}>{r.category}</span>}
        <span className="rca-text">{r.title}</span>
      </div>
      <div className="rca-meta">
        {r.count >= 2 && (
          <span className="rca-repeat">
            Repeated {r.count} times · most recent {r.lastDate}
          </span>
        )}
        {r.count < 2 && <span className="muted">Occurred {r.lastDate}</span>}
        {r.components.length > 0 && (
          <span className="rca-components">
            Affected: {r.components.join(", ")}
          </span>
        )}
      </div>
      {r.playbook && <PlaybookBlock playbook={r.playbook} />}
      {r.cause && (
        <div className="rca-cause">
          <div className="rca-resolve-label">Cause (HPE)</div>
          <RichText text={r.cause} />
        </div>
      )}
      {r.resolution && (
        <div className="rca-resolve">
          <div className="rca-resolve-label">Resolution (HPE)</div>
          <RichText text={r.resolution} />
        </div>
      )}
      {r.docUrl && (
        <div className="rca-doc">
          <a href={r.docUrl} target="_blank" rel="noreferrer">
            Official HPE documentation
          </a>
        </div>
      )}
      {r.bugs.map((bug) => (
        <BugBlock key={bug.id} bug={bug} />
      ))}
    </div>
  );
}

const NUMBERED = /^(\d+)\.\s+/;

/** Render an HPE text block: lead lines as paragraphs, numbered lines as an ordered list. */
function RichText({ text }: { text: string }) {
  const clean = (s: string) => s.replace(/\*\*/g, "");
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim());
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        const out: ReactNode[] = [];
        let list: { n: number; text: string }[] = [];
        const flushList = (keySuffix: string) => {
          if (list.length > 0) {
            out.push(
              <ol key={`ol-${bi}-${keySuffix}`} className="rca-hpe-steps">
                {list.map((item, li) => (
                  <li key={li} value={item.n}>{clean(item.text)}</li>
                ))}
              </ol>
            );
            list = [];
          }
        };
        for (const line of lines) {
          const m = NUMBERED.exec(line);
          if (m) list.push({ n: Number(m[1]), text: line.slice(m[0].length) });
          else {
            flushList(String(out.length));
            const withBold = clean(line);
            if (/:$/.test(line)) {
              out.push(<div key={`p-${bi}-${out.length}`} className="rca-hpe-lead">{withBold}</div>);
            } else {
              out.push(<p key={`p-${bi}-${out.length}`}>{withBold}</p>);
            }
          }
        }
        flushList("end");
        return <div key={bi}>{out}</div>;
      })}
    </>
  );
}

function PlaybookBlock({ playbook }: { playbook: Playbook }) {
  return (
    <div className="rca-playbook">
      <div className="rca-playbook-label">What this error means</div>
      <p>{playbook.meaning}</p>
      {playbook.details && playbook.details.length > 0 && (
        <div className="rca-playbook-details">
          {playbook.details.map((d, i) => (
            <div key={i} className="rca-playbook-detail">
              <div className="rca-playbook-detail-label">{d.label}</div>
              <div className="rca-playbook-detail-value">{d.value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="rca-playbook-label">What to do</div>
      <ol className="rca-playbook-steps">
        {playbook.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

function BugBlock({ bug }: { bug: BugEntry }) {
  return (
    <div className="rca-fix">
      <div className="rca-fix-label">Known firmware issue (HPE advisory)</div>
      <div className="rca-bug-title">{bug.title}</div>
      <p className="rca-bug-desc">{bug.description}</p>
      {bug.results.map((res, i) => (
        <div key={i} className={`rca-bug-status ${res.affected ? "affected" : "ok"}`}>
          {res.label}
          {res.fix && <div className="rca-bug-fix">{res.fix}</div>}
        </div>
      ))}
    </div>
  );
}
