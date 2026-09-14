/**
 * The `Rules` branch of the active layer's Style section: the presets, the
 * rule list, the unmatched colour and the rule form for ONE layer.
 *
 * Rules are stored in the layer store; `handleSync` compiles the effective
 * list (`effectiveRules` + `effectiveRulesEnabled`, `features/rules/colorBy.ts`)
 * and pushes the result into `CityModelHandle.setStyle` or, for a streaming
 * layer, into the worker through `setRules`.
 *
 * It lives under `ui/layers/` because a rule is a LAYER's styling, not a
 * property of the current selection — this was the inspector's "Rules" tab
 * (`RuleBuilderTab`), five tabs away from the layer it edits. It carries no
 * heading and no On/Off switch of its own any more: `StyleSection` above it
 * names the layer on the affected-unit line and owns the mode through
 * `Color by` (R10). Two controls for "do rules paint?" is how the map and the
 * panel come to disagree.
 *
 * Rules are per-layer, so the editor always edits exactly one layer — the
 * workspace's active one. It used to carry a target-layer `<select>` of its
 * own, which let it point at a DIFFERENT layer from the one the rest of the
 * UI was describing; the layer list is now the only place a layer is chosen.
 */

import { useCallback, useRef, useState } from "react";
import type { CityModel } from "../../domain/citymodel/types";
import { useLayerStore } from "../../features/layers/layerStore";
import { useStreamStore } from "../../features/streaming/streamStore";
import {
  getResidentModel,
  type ResidentModel,
} from "../../features/streaming/residentModel";
import type {
  Condition,
  ConditionOperator,
  LogicMode,
  Rule,
} from "../../features/rules/types";
import { isSyntheticRule } from "../../features/rules/colorBy";
import {
  useRuleDraftStore,
  type RuleFormValues,
} from "../../features/rules/ruleDraftStore";
import { RULE_PRESETS, type RulePreset } from "../../features/rules/presets";
import { UNMATCHED_COLOR_HEX } from "../../scene/cityColors";
import { nextRuleColor } from "../../features/rules/nextRuleColor";
import { downloadText } from "../../platform/download";
import { useComputedColumnStore } from "../../insights/computedColumns";

export interface RulesEditorProps {
  readonly model: CityModel;
  readonly layerId: string;
}

/** Roof metrics, always available for a condition whatever the file carries:
 *  `evaluateRule` resolves a condition's `field` against `RoofMetrics` FIRST
 *  and only then against the object's attributes, so these four names are
 *  reserved. The spec writes them as `roof.area` / `roof.inclination` /
 *  `roof.azimuth`; the engine's own keys are what a rule must STORE, and
 *  showing the stored key here is what keeps the row's condition text
 *  ("inclinationDeg < 10") readable as the thing that was chosen. */
const METRIC_FIELDS = [
  "areaSqM",
  "inclinationDeg",
  "azimuthDeg",
  "elevationM",
] as const;

/** The CityGML/CityJSON attributes worth promoting above the alphabet when
 *  the model actually carries them — the four the spec names. A model has
 *  dozens of keys and these are the ones a rule is usually about. */
const NAMED_ATTRIBUTES: ReadonlyArray<string> = [
  "measuredHeight",
  "yearOfConstruction",
  "roofType",
  "function",
];

const OPERATORS: ConditionOperator[] = [">", "<", "=", ">=", "<="];

export function RulesEditor({ model, layerId }: RulesEditorProps) {
  const layer = useLayerStore((s) => s.layers.find((l) => l.id === layerId));
  const rules = layer?.rules ?? [];
  // A synthetic catch-all is DERIVED (`effectiveRules`) and never enters the
  // store — but if one ever did, it is a rendering device, not something the
  // user wrote, and an Edit or a Delete on it would mean nothing.
  const visibleRules = rules.filter((r) => !isSyntheticRule(r));
  const isStreaming = layer?.isStreaming ?? false;
  const unmatchedColor = layer?.unmatchedColor ?? UNMATCHED_COLOR_HEX;
  // Under a texture theme the images cover their faces outright (the mesh
  // whites those vertices out), so a rule colour shows only on faces that
  // have no image. Said here, where the user would otherwise wonder why a
  // rule "does nothing".
  const textureThemeActive = layer?.selectedAppearance?.kind === "texture";

  // Only subscribed for a streaming layer's re-render trigger; for a static
  // layer this is always undefined and unused below.
  const streamVersion = useStreamStore((s) => s.streams[layerId]?.version);

  const addRule = useLayerStore((s) => s.addRule);
  const updateRule = useLayerStore((s) => s.updateRule);
  const deleteRule = useLayerStore((s) => s.deleteRule);
  const reorderRules = useLayerStore((s) => s.reorderRules);
  const updateLayer = useLayerStore((s) => s.updateLayer);

  // The unsaved editor's state, keyed by layerId — moved out of local
  // `useState` (Task 27). Nothing about the form lives in this component, so
  // rendering it for a different layer can neither carry the old layer's
  // half-typed rule across (the leak the seeded-once `useState` produced) nor
  // lose it when the panel remounts on `key={layerId}`. See
  // `features/rules/ruleDraftStore.ts`.
  const draft = useRuleDraftStore((s) => s.drafts[layerId] ?? null);
  const setDraft = useRuleDraftStore((s) => s.setDraft);
  const clearDraft = useRuleDraftStore((s) => s.clearDraft);
  const showForm = draft?.open ?? false;
  const editingId = draft?.editingId ?? null;

  const importRef = useRef<HTMLInputElement>(null);
  const [draggingRuleId, setDraggingRuleId] = useState<string | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);

  // Collect attribute fields from all objects for the field dropdown. A
  // streaming layer has no complete `CityModel` to walk — only whatever
  // cells are currently resident — so its fields come from the merged
  // resident model instead: object attribute keys collected from the
  // records themselves, unioned with `surfaceAttrKeys` (already unioned
  // and sorted per cell by the worker — see residentModel.ts).
  const attributeFields = isStreaming
    ? collectAttributeFieldsFromResidentModel(
        getResidentModel(layerId, streamVersion ?? 0),
      )
    : collectAttributeFields(model);
  // Spec §8: a tool's results are listed in their own COMPUTED optgroup. They
  // are already IN `attributeFields` — `runQueue` merges the values onto the
  // objects, so `collectAttributeFields` finds them — so all that happens here
  // is the grouping. The store's own object, never `computedColumnsOf` (a
  // fresh Set per call cannot be a selector snapshot).
  const computedColumns = useComputedColumnStore((s) => s.byLayer[layerId]);
  const ordered = orderFields(attributeFields);
  const computedFields = ordered.filter(
    (field) => computedColumns?.[field] !== undefined,
  );
  const allFields = ordered.filter(
    (field) => computedColumns?.[field] === undefined,
  );

  /**
   * A rule the user just created has to be able to PAINT, or the control that
   * created it did nothing visible. Adding a preset or saving a first rule
   * while the layer is still on "surface" is therefore also the decision to
   * colour by rules (slice ruling, T28).
   *
   * Only from `"surface"`, the undecided mode: a layer deliberately set to
   * `"single"` keeps its one colour, because there the user has already said
   * what they want and a rule they are drafting is not yet a change of mind.
   */
  const ensureRulesMode = useCallback(() => {
    const current = useLayerStore
      .getState()
      .layers.find((l) => l.id === layerId);
    if (current?.colorBy === "surface") {
      updateLayer(layerId, { colorBy: "rules" });
    }
  }, [layerId, updateLayer]);

  const applyPreset = useCallback(
    (preset: RulePreset) => {
      addRule(layerId, preset.create());
      ensureRulesMode();
    },
    [addRule, ensureRulesMode, layerId],
  );

  const handleExport = useCallback(() => {
    const currentRules =
      useLayerStore.getState().layers.find((l) => l.id === layerId)?.rules ??
      [];
    downloadText(JSON.stringify(currentRules, null, 2), "rules.json");
  }, [layerId]);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        try {
          const imported = JSON.parse(text) as Rule[];
          if (!Array.isArray(imported)) return;
          for (const rule of imported) {
            if (rule.name && rule.color && Array.isArray(rule.conditions)) {
              // A fresh id on the way in, which is also what keeps an
              // imported rule from ever wearing the synthetic prefix.
              addRule(layerId, { ...rule, id: crypto.randomUUID() });
            }
          }
        } catch {
          // Invalid JSON — silently ignore
        }
      });
      // Reset so the same file can be re-imported
      e.target.value = "";
    },
    [addRule, layerId],
  );

  /** Precedence is first-match-wins, so the ORDER of the list is a setting.
   *  Indices are looked up in the layer's own array rather than taken from
   *  the rendered position: the rows are a filtered view of it. */
  const moveRule = useCallback(
    (ruleId: string, delta: -1 | 1) => {
      const current =
        useLayerStore.getState().layers.find((l) => l.id === layerId)?.rules ??
        [];
      const shown = current.filter((r) => !isSyntheticRule(r));
      const at = shown.findIndex((r) => r.id === ruleId);
      const neighbour = at < 0 ? undefined : shown[at + delta];
      if (neighbour === undefined) return;
      reorderRules(
        layerId,
        current.findIndex((r) => r.id === ruleId),
        current.findIndex((r) => r.id === neighbour.id),
      );
    },
    [layerId, reorderRules],
  );

  const moveRuleTo = useCallback(
    (ruleId: string, targetId: string) => {
      const current =
        useLayerStore.getState().layers.find((layer) => layer.id === layerId)
          ?.rules ?? [];
      const from = current.findIndex((rule) => rule.id === ruleId);
      const to = current.findIndex((rule) => rule.id === targetId);
      if (from < 0 || to < 0 || from === to) return;
      reorderRules(layerId, from, to);
    },
    [layerId, reorderRules],
  );

  const openAddForm = useCallback(() => {
    // The store, not `layer.rules`: this callback is memoised on
    // `[layerId, setDraft]`, and a captured rule list would be the list as it
    // was when the callback was built — so the rule added right after a Save
    // would rotate from a palette that has not heard about the saved one. The
    // same read `moveRule` above makes, for the same reason.
    const rules =
      useLayerStore.getState().layers.find((l) => l.id === layerId)?.rules ??
      [];
    setDraft(layerId, {
      editingId: null,
      open: true,
      form: defaultRuleFormValues(rules),
    });
  }, [layerId, setDraft]);

  const openEditForm = useCallback(
    (rule: Rule) => {
      setDraft(layerId, {
        editingId: rule.id,
        open: true,
        form: ruleFormValuesFromRule(rule),
      });
    },
    [layerId, setDraft],
  );

  const handleFormChange = useCallback(
    (form: RuleFormValues) => {
      if (draft === null) return;
      setDraft(layerId, { ...draft, form });
    },
    [draft, layerId, setDraft],
  );

  const handleFormSave = useCallback(
    (form: RuleFormValues) => {
      if (draft === null) return;
      if (draft.editingId !== null) {
        // An EDIT is not a decision about how the layer is coloured, so the
        // mode is left exactly as it was.
        updateRule(layerId, draft.editingId, {
          name: form.name,
          color: form.color,
          logic: form.logic,
          conditions: [...form.conditions],
        });
      } else {
        addRule(layerId, {
          id: crypto.randomUUID(),
          name: form.name,
          color: form.color,
          logic: form.logic,
          conditions: [...form.conditions],
          enabled: true,
        });
        if (draft.origin === "style-by-result") {
          // M3 ruling C6: the user pressed a button whose whole promise is
          // "show me this on the map", so a RESULT draft's Save switches the
          // mode from ANY starting point — `"single"` included, where
          // `ensureRulesMode` deliberately holds back.
          updateLayer(layerId, { colorBy: "rules" });
        } else {
          ensureRulesMode();
        }
      }
      clearDraft(layerId);
    },
    [
      addRule,
      clearDraft,
      draft,
      ensureRulesMode,
      layerId,
      updateLayer,
      updateRule,
    ],
  );

  const handleFormCancel = useCallback(() => {
    clearDraft(layerId);
  }, [clearDraft, layerId]);

  return (
    <div className="rules-editor">
      {textureThemeActive && (
        <p className="rule-appearance-note" role="note">
          Texture theme active: rule colours show only on untextured surfaces.
          Pick "None" in the layer row's appearance dropdown to colour every
          surface.
        </p>
      )}

      {/* Presets FIRST: the readable path into rule colouring is picking one,
          not writing a condition. */}
      <div className="rule-presets" role="group" aria-label="Rule presets">
        {RULE_PRESETS.map((preset) => (
          <button
            type="button"
            key={preset.label}
            className="preset-chip"
            title={preset.description}
            onClick={() => applyPreset(preset)}
          >
            <span
              className="preset-chip-swatch"
              style={{ backgroundColor: preset.color }}
              aria-hidden
            />
            {preset.label}
          </button>
        ))}
      </div>

      {visibleRules.length === 0 && !showForm && (
        <p className="rule-empty">
          No rules yet — pick a preset above, or add one below.
        </p>
      )}

      {visibleRules.length > 0 && (
        <ul className="rule-list" aria-label="Rules">
          {visibleRules.map((rule, idx) => (
            <li
              className={`rule-item ${dragTargetId === rule.id ? "rule-item-drag-target" : ""}`}
              key={rule.id}
              onDragOver={(event) => {
                if (draggingRuleId === null || draggingRuleId === rule.id)
                  return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragTargetId(rule.id);
              }}
              onDragLeave={(event) => {
                if (
                  event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  return;
                setDragTargetId((target) =>
                  target === rule.id ? null : target,
                );
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingRuleId !== null && draggingRuleId !== rule.id) {
                  moveRuleTo(draggingRuleId, rule.id);
                }
                setDraggingRuleId(null);
                setDragTargetId(null);
              }}
            >
              {showForm && editingId === rule.id && draft !== null ? (
                <RuleForm
                  values={draft.form}
                  fields={allFields}
                  computedFields={computedFields}
                  saveLabel="Update"
                  onChange={handleFormChange}
                  onSave={handleFormSave}
                  onCancel={handleFormCancel}
                />
              ) : (
                <RuleRow
                  rule={rule}
                  isFirst={idx === 0}
                  isLast={idx === visibleRules.length - 1}
                  dragDisabled={showForm}
                  onDragStart={() => setDraggingRuleId(rule.id)}
                  onDragEnd={() => {
                    setDraggingRuleId(null);
                    setDragTargetId(null);
                  }}
                  onDragCancel={() => {
                    setDraggingRuleId(null);
                    setDragTargetId(null);
                  }}
                  onToggle={() =>
                    updateRule(layerId, rule.id, { enabled: !rule.enabled })
                  }
                  onMoveUp={() => moveRule(rule.id, -1)}
                  onMoveDown={() => moveRule(rule.id, 1)}
                  onEdit={() => openEditForm(rule)}
                  onDelete={() => deleteRule(layerId, rule.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {/* The two facts a rule list cannot show on its own: what wins when two
          rules match, and what the roofs no rule reached are wearing. */}
      <p className="rule-unmatched">
        First matching rule wins. Unmatched roofs:
        <input
          type="color"
          className="rule-unmatched-swatch"
          aria-label="Unmatched roofs"
          value={unmatchedColor}
          onChange={(e) =>
            updateLayer(layerId, { unmatchedColor: e.target.value })
          }
        />
        <span className="rule-unmatched-name">{colorName(unmatchedColor)}</span>
      </p>

      {showForm && editingId === null && draft !== null ? (
        <RuleForm
          values={draft.form}
          fields={allFields}
          computedFields={computedFields}
          saveLabel="Add"
          onChange={handleFormChange}
          onSave={handleFormSave}
          onCancel={handleFormCancel}
        />
      ) : (
        <button
          type="button"
          className="rule-add-btn"
          onClick={openAddForm}
          disabled={showForm}
          title={
            showForm ? "Finish or cancel the current rule first" : undefined
          }
        >
          + Add rule
        </button>
      )}

      {/* Import / Export is the escape hatch, not the workflow: a native
          disclosure keeps it one Tab and one Enter away without spending two
          buttons of the panel's width on it at rest. */}
      <details className="rule-more">
        <summary className="rule-more-summary">More</summary>
        <div className="rule-io-row">
          <button
            type="button"
            className="rule-io-btn"
            onClick={handleExport}
            disabled={rules.length === 0}
          >
            Export rules
          </button>
          <button
            type="button"
            className="rule-io-btn"
            onClick={() => importRef.current?.click()}
          >
            Import rules
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            hidden
          />
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule Row (display mode)
// ---------------------------------------------------------------------------

function RuleRow({
  rule,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onToggle,
  onMoveUp,
  onMoveDown,
  dragDisabled,
  onDragStart,
  onDragEnd,
  onDragCancel,
}: {
  rule: Rule;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  dragDisabled: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragCancel: () => void;
}) {
  return (
    <div className={`rule-body ${rule.enabled ? "" : "rule-disabled"}`}>
      <div className="rule-head">
        <button
          type="button"
          className="rule-drag-handle"
          aria-label={`Drag rule: ${rule.name}`}
          title="Drag to change precedence, or use the Up and Down arrow keys"
          aria-keyshortcuts="ArrowUp ArrowDown"
          draggable={!dragDisabled}
          disabled={dragDisabled}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          onKeyDown={(event) => {
            if (event.key === "Escape") onDragCancel();
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              if (dragDisabled) return;
              if (event.key === "ArrowUp" && !isFirst) onMoveUp();
              if (event.key === "ArrowDown" && !isLast) onMoveDown();
            }
          }}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <circle cx="3" cy="2.5" r="1" />
            <circle cx="9" cy="2.5" r="1" />
            <circle cx="3" cy="6" r="1" />
            <circle cx="9" cy="6" r="1" />
            <circle cx="3" cy="9.5" r="1" />
            <circle cx="9" cy="9.5" r="1" />
          </svg>
        </button>
        <span
          className="rule-swatch"
          style={{ backgroundColor: rule.color }}
          aria-hidden
        />
        <span className="rule-info">
          <span className="rule-name">{rule.name}</span>
          <span className="rule-summary">{conditionText(rule)}</span>
        </span>
        {/* The rule's OWN enabled flag — "does THIS rule apply?", not "do
            rules apply?", which is the section's `Color by`. */}
        <input
          type="checkbox"
          className="rule-enabled"
          checked={rule.enabled}
          aria-label={`Enabled: ${rule.name}`}
          onChange={onToggle}
        />
      </div>
      {/* Every accessible name STARTS with the button's own words, so the
          visible label is a prefix of what a screen reader announces. */}
      <div className="rule-actions">
        <button
          type="button"
          className="rule-action-btn"
          aria-label={`Edit: ${rule.name}`}
          onClick={onEdit}
        >
          Edit
        </button>
        <button
          type="button"
          className="rule-action-btn"
          aria-label={`Delete: ${rule.name}`}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/** The row's one-line condition, in the same words the form wrote it with. A
 *  rule with no conditions matches everything — `evaluateRule` short-circuits
 *  to true — so it is described, not left blank. */
function conditionText(rule: Rule): string {
  if (rule.conditions.length === 0) return "All roofs";
  return rule.conditions
    .map((c) => `${c.field} ${c.operator} ${c.value}`)
    .join(` ${rule.logic} `);
}

/** The unmatched swatch's label: the palette's NAME while it is the palette's
 *  colour, the hex once the user has picked their own. A name is what makes
 *  the default legible ("Unassigned grey" is a fact about the design); a hex
 *  is all that can honestly be said about an arbitrary colour. */
function colorName(hex: string): string {
  return hex.toLowerCase() === UNMATCHED_COLOR_HEX.toLowerCase()
    ? "Unassigned grey"
    : hex;
}

// ---------------------------------------------------------------------------
// Rule Form (add/edit mode)
// ---------------------------------------------------------------------------

interface RuleFormProps {
  values: RuleFormValues;
  fields: string[];
  /** The layer's computed columns, listed in their own optgroup below the
   *  file's fields (spec §8). */
  computedFields?: ReadonlyArray<string>;
  /** "Add" for a new rule, "Update" for an existing one — the caller already
   *  knows which (it is the one that knows the draft's `editingId`), so the
   *  form does not have to infer it from `values`. */
  saveLabel: string;
  onChange: (values: RuleFormValues) => void;
  onSave: (values: RuleFormValues) => void;
  onCancel: () => void;
}

/**
 * Controlled by the caller's draft (`RuleDraft.form`): every keystroke calls
 * {@link RuleFormProps.onChange} rather than touching local state, which is
 * what lets the draft survive this component being rendered for another layer
 * and back (Task 27) — there is no local state here to leak or to lose.
 */
function RuleForm({
  values,
  fields,
  computedFields = [],
  saveLabel,
  onChange,
  onSave,
  onCancel,
}: RuleFormProps) {
  const { name, color, logic, conditions } = values;

  const addCondition = () => {
    onChange({
      ...values,
      conditions: [
        ...conditions,
        { field: "inclinationDeg", operator: "<", value: 0 },
      ],
    });
  };

  const removeCondition = (idx: number) => {
    onChange({ ...values, conditions: conditions.filter((_, i) => i !== idx) });
  };

  const updateCondition = (idx: number, patch: Partial<Condition>) => {
    onChange({
      ...values,
      conditions: conditions.map((c, i) =>
        i === idx ? { ...c, ...patch } : c,
      ),
    });
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ ...values, name: name.trim() });
  };

  return (
    <div className="rule-form">
      <div className="rule-form-row">
        <input
          className="rule-input"
          placeholder="Rule name"
          aria-label="Rule name"
          value={name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
        />
        <input
          type="color"
          className="rule-color-picker"
          aria-label="Rule colour"
          value={color}
          onChange={(e) => onChange({ ...values, color: e.target.value })}
        />
      </div>

      {conditions.length > 1 && (
        <div className="rule-form-row">
          <select
            className="rule-select"
            aria-label="Combine conditions"
            value={logic}
            onChange={(e) =>
              onChange({ ...values, logic: e.target.value as LogicMode })
            }
          >
            <option value="AND">AND (all must match)</option>
            <option value="OR">OR (any must match)</option>
          </select>
        </div>
      )}

      {conditions.map((cond, idx) => (
        <div
          key={idx}
          className="condition-row"
          role="group"
          aria-label={`Condition ${idx + 1}`}
        >
          <select
            className="rule-select"
            aria-label="Attribute"
            value={cond.field}
            onChange={(e) => updateCondition(idx, { field: e.target.value })}
          >
            {fields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
            {computedFields.length > 0 && (
              <optgroup label="COMPUTED">
                {computedFields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <select
            className="rule-select rule-select-sm"
            aria-label="Operator"
            value={cond.operator}
            onChange={(e) =>
              updateCondition(idx, {
                operator: e.target.value as ConditionOperator,
              })
            }
          >
            {OPERATORS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
          <input
            className="rule-input rule-input-sm"
            aria-label="Value"
            value={String(cond.value)}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") return;
              const num = Number(raw);
              updateCondition(idx, {
                value:
                  raw === "true"
                    ? true
                    : raw === "false"
                      ? false
                      : isNaN(num)
                        ? raw
                        : num,
              });
            }}
          />
          {conditions.length > 1 && (
            <button
              type="button"
              className="rule-action-btn"
              aria-label={`Remove condition ${idx + 1}`}
              onClick={() => removeCondition(idx)}
            >
              x
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        className="rule-add-condition"
        onClick={addCondition}
      >
        + Condition
      </button>

      <div className="rule-form-actions">
        <button type="button" className="rule-save-btn" onClick={handleSave}>
          {saveLabel}
        </button>
        <button type="button" className="rule-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The "+ Add rule" form's starting values.
 *
 * §6.2's "the next palette colour" is not a result-card rule: a user adding a
 * third rule by hand has exactly the same problem, and the editor and the card
 * must not disagree about which colour is next.
 */
function defaultRuleFormValues(rules: ReadonlyArray<Rule>): RuleFormValues {
  return {
    name: "",
    color: nextRuleColor(rules),
    logic: "AND",
    conditions: [{ field: "inclinationDeg", operator: "<", value: 10 }],
  };
}

/** The "Edit" form's starting values, seeded from the rule being edited. */
function ruleFormValuesFromRule(rule: Rule): RuleFormValues {
  return {
    name: rule.name,
    color: rule.color,
    logic: rule.logic,
    conditions: [...rule.conditions],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The condition field list, in the order a rule is usually about: the four
 * roof metrics (always present, whatever the file carries), then the named
 * attributes the model actually has, then everything else alphabetically.
 *
 * Alphabetical alone put `areaSqM` next to a CityGML `class` and buried
 * `measuredHeight` in the middle of the file's own keys — a list of forty
 * entries in which the four a user wants are not findable is a list nobody
 * reads.
 */
function orderFields(attributeFields: ReadonlyArray<string>): string[] {
  const metrics: ReadonlyArray<string> = METRIC_FIELDS;
  const named = NAMED_ATTRIBUTES.filter((k) => attributeFields.includes(k));
  const rest = attributeFields.filter(
    (k) => !metrics.includes(k) && !named.includes(k),
  );
  return [...metrics, ...named, ...rest];
}

function collectAttributeFields(model: CityModel): string[] {
  const fields = new Set<string>();
  for (const obj of Object.values(model.objects)) {
    if (!obj) continue;
    for (const key of Object.keys(obj.attributes)) {
      fields.add(key);
    }
    for (const surface of obj.surfaces) {
      for (const key of Object.keys(surface.attributes)) {
        fields.add(key);
      }
    }
  }
  return [...fields].sort();
}

/** Streaming counterpart of `collectAttributeFields`: object attribute keys
 *  come from the resident `ResidentObjectRecord`s directly (no rings
 *  needed), and surface attribute keys are already unioned by the worker
 *  per cell (`CellEntry.surfaceAttrKeys`) and merged across cells by
 *  `getResidentModel` — nothing here walks `Surface.rings`. */
function collectAttributeFieldsFromResidentModel(
  model: ResidentModel,
): string[] {
  const fields = new Set<string>(model.surfaceAttrKeys);
  for (const record of Object.values(model.objects)) {
    for (const key of Object.keys(record.attributes)) {
      fields.add(key);
    }
  }
  return [...fields].sort();
}
