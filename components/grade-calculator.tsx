"use client";
import { useState } from "react";
import {
  Plus,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  Trash2,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  calculateGrade,
  redistribute,
  moveAssessment,
  GradeItem,
} from "@/lib/grade/engine";
const format = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "—" : Number(n.toFixed(2)).toString();
export function GradeCalculator({
  initial = [],
  sourceLabel = "Custom calculator",
}: {
  initial?: GradeItem[];
  sourceLabel?: string;
}) {
  const [items, setItems] = useState<GradeItem[]>(() =>
      initial.map((i) => ({ ...i })),
    ),
    [target, setTarget] = useState("80"),
    [changed, setChanged] = useState(false),
    [collapsed, setCollapsed] = useState<string[]>([]),
    [transfer, setTransfer] = useState(""),
    [destination, setDestination] = useState("even"),
    [notice, setNotice] = useState(""),
    [undo, setUndo] = useState<GradeItem[] | null>(null);
  const stats = calculateGrade(
    items,
    target.trim() === "" ? undefined : Number(target),
  );
  const targetInvalid =
    target.trim() !== "" &&
    (!Number.isFinite(Number(target)) ||
      Number(target) < 0 ||
      Number(target) > 100);
  function commit(next: GradeItem[]) {
    setUndo(items);
    setItems(next);
    setChanged(true);
    setNotice("");
  }
  function edit(id: string, key: keyof GradeItem, value: string) {
    commit(items.map((i) => (i.id === id ? { ...i, [key]: value } : i)));
  }
  function reset() {
    setItems(initial.map((i) => ({ ...i })));
    setTarget("80");
    setChanged(false);
    setTransfer("");
    setNotice("");
    setUndo(null);
  }
  const groups = [...new Set(items.map((i) => i.group).filter(Boolean))];
  const renderRow = (i: GradeItem, index: number) => (
    <div className="assessment-row" key={i.id}>
      <div className="assessment-name">
        <label className="sr-only" htmlFor={`name-${i.id}`}>
          Assessment name {index + 1}
        </label>
        <input
          id={`name-${i.id}`}
          value={i.name}
          onChange={(e) => edit(i.id, "name", e.target.value)}
          placeholder="Assessment name"
        />
        <label className="group-input">
          Group
          <input
            aria-label={`Group for ${i.name}`}
            value={i.group}
            placeholder="Optional"
            onChange={(e) => edit(i.id, "group", e.target.value)}
          />
        </label>
      </div>
      <label className="number-field">
        <span className="mobile-label">Weight</span>
        <input
          aria-label={`Weight for ${i.name}`}
          inputMode="decimal"
          value={i.weight}
          onChange={(e) => edit(i.id, "weight", e.target.value)}
        />
        <span>%</span>
      </label>
      <label className="number-field">
        <span className="mobile-label">Grade</span>
        <input
          aria-label={`Grade for ${i.name}`}
          inputMode="decimal"
          placeholder="—"
          value={i.grade}
          onChange={(e) => edit(i.id, "grade", e.target.value)}
        />
        <span>%</span>
      </label>
      <div className="row-actions">
        <button
          aria-label={`Move ${i.name} up`}
          disabled={index === 0}
          onClick={() => commit(moveAssessment(items, i.id, -1))}
        >
          <ArrowUp size={15} />
        </button>
        <button
          aria-label={`Move ${i.name} down`}
          disabled={index === items.length - 1}
          onClick={() => commit(moveAssessment(items, i.id, 1))}
        >
          <ArrowDown size={15} />
        </button>
        <button
          aria-label={`Drop and transfer ${i.name}`}
          onClick={() => {
            setTransfer(i.id);
            setDestination("even");
          }}
        >
          <ArrowRightLeft size={15} />
        </button>
        <button
          aria-label={`Remove ${i.name}`}
          onClick={() => commit(items.filter((a) => a.id !== i.id))}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
  return (
    <div className="calculator-layout">
      <section className="assessment-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">YOUR ASSESSMENTS</span>
            <h2>Small steps. Clear numbers.</h2>
          </div>
          <button className="button button-quiet" onClick={reset}>
            <RotateCcw size={15} /> Reset
          </button>
        </div>
        <p className="panel-subtitle">
          Enter grades as you get them. Leave unfinished work blank.
        </p>
        <div className="local-note">
          {changed
            ? "Your changes apply only to this page."
            : "Grades and edits are not saved when you leave or reload."}{" "}
          {undo && (
            <button
              onClick={() => {
                setItems(undo);
                setUndo(null);
              }}
            >
              Undo last edit
            </button>
          )}
        </div>
        <div className="assessment-head">
          <span>ASSESSMENT</span>
          <span>WEIGHT</span>
          <span>YOUR GRADE</span>
          <span />
        </div>
        {!items.length && (
          <div className="empty-calculator">
            <span className="empty-plus">+</span>
            <h3>Start with your first assessment.</h3>
            <p>
              Add the weights from your course outline, then enter the grades
              you know.
            </p>
          </div>
        )}
        {items
          .filter((i) => !i.group)
          .map((i) => renderRow(i, items.indexOf(i)))}
        {groups.map((group) => (
          <section className="assessment-group" key={group}>
            <div className="group-heading">
              <button
                onClick={() =>
                  setCollapsed((c) =>
                    c.includes(group)
                      ? c.filter((x) => x !== group)
                      : [...c, group],
                  )
                }
                aria-expanded={!collapsed.includes(group)}
              >
                {collapsed.includes(group) ? (
                  <ChevronRight size={16} />
                ) : (
                  <ChevronDown size={16} />
                )}{" "}
                {group}
                <span>
                  {format(
                    items
                      .filter((i) => i.group === group)
                      .reduce((s, i) => s + Number(i.weight), 0),
                  )}
                  %
                </span>
              </button>
              <label>
                Grade all
                <input
                  aria-label={`Grade all ${group}`}
                  inputMode="decimal"
                  placeholder="—"
                  onBlur={(e) => {
                    if (e.target.value.trim() !== "") {
                      commit(
                        items.map((i) =>
                          i.group === group
                            ? { ...i, grade: e.target.value }
                            : i,
                        ),
                      );
                      e.target.value = "";
                    }
                  }}
                />
              </label>
            </div>
            {!collapsed.includes(group) &&
              items
                .filter((i) => i.group === group)
                .map((i) => renderRow(i, items.indexOf(i)))}
          </section>
        ))}
        <button
          className="add-assessment"
          onClick={() =>
            commit([
              ...items,
              {
                id: crypto.randomUUID(),
                name: `Assessment ${items.length + 1}`,
                weight: "0",
                grade: "",
                group: "",
              },
            ])
          }
        >
          <Plus size={18} /> Add an assessment
        </button>
        <div className="weight-total">
          <span>Total assessment weight</span>
          <strong
            className={Math.abs(stats.total - 100) < 0.000001 ? "positive" : ""}
          >
            {format(stats.total)} / 100%
          </strong>
        </div>
        {stats.error && (
          <p className="error-note" role="alert">
            {stats.error}
          </p>
        )}
        {!stats.error &&
          Math.abs(stats.total - 100) > 0.000001 &&
          items.length > 0 && (
            <p className="warning-note">
              Your weights total {format(stats.total)}%. Set the complete scheme
              to 100% to calculate a target.
            </p>
          )}
        {transfer && (
          <div className="transfer-panel">
            <h3>Drop {items.find((i) => i.id === transfer)?.name}</h3>
            <p>
              Move its weight to another assessment, or split it equally across
              the remaining assessments.
            </p>
            <label>
              Transfer weight to
              <select
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                <option value="even">All remaining assessments equally</option>
                {items
                  .filter((i) => i.id !== transfer)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="button-row">
              <button
                className="button button-dark"
                onClick={() => {
                  try {
                    commit(redistribute(items, transfer, destination));
                    setTransfer("");
                  } catch (e) {
                    setNotice((e as Error).message);
                  }
                }}
              >
                Apply transfer
              </button>
              <button
                className="button button-quiet"
                onClick={() => setTransfer("")}
              >
                Cancel
              </button>
            </div>
            {notice && <p role="alert">{notice}</p>}
          </div>
        )}
      </section>
      <aside className="grade-summary">
        <span className="eyebrow">THE BIG PICTURE</span>
        <h2>Your grade, so far.</h2>
        <div className="current-grade">
          {format(stats.current)}
          <span>{stats.current === null ? "" : "%"}</span>
        </div>
        <p>Average on graded work</p>
        <div className="progress-track">
          <div
            style={{ width: `${Math.min(100, Math.max(0, stats.completed))}%` }}
          />
        </div>
        <div className="progress-caption">
          <span>{format(stats.completed)}% graded</span>
          <span>{format(Math.max(0, 100 - stats.completed))}% remaining</span>
        </div>
        <div className="target-area">
          <label htmlFor="target-grade">Where do you want to land?</label>
          <div className="target-input">
            <input
              id="target-grade"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
            <span>% target</span>
          </div>
          {targetInvalid ? (
            <p role="alert">Choose a target between 0 and 100.</p>
          ) : stats.required !== null ? (
            <div className="required-grade">
              <strong>{format(stats.required)}%</strong>
              <p>
                {stats.required > 100
                  ? "This target is out of reach under the current weights."
                  : stats.required === 0
                    ? "You’ve already earned enough weighted points for this target."
                    : "Average needed on the remaining work."}
              </p>
            </div>
          ) : (
            <p className="target-explanation">
              {stats.completed >= 100
                ? "All assessments are graded. Your final result is above."
                : "Add a complete grading scheme to explore your target."}
            </p>
          )}
        </div>
        <p className="summary-footnote">
          {sourceLabel}
          <br />
          Use your official outline for grading conditions and final results.
        </p>
      </aside>
    </div>
  );
}
