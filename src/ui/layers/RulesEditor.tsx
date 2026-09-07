/**
 * The rule editor: create and manage one layer's colorization rules.
 *
 * Rules are stored in the layer store; `handleSync` compiles them
 * (`compileRuleEvaluator`) and pushes the result into
 * `CityModelHandle.setStyle`.
 *
 * It lives under `ui/layers/` because a rule is a LAYER's styling, not a
 * property of the current selection — this was the inspector's "Rules" tab
 * (`RuleBuilderTab`), five tabs away from the layer it edits, and it is now
 * the body of the active layer's Style section. Same content, no tab chrome.
 *
 * Rules are per-layer, so the editor always edits exactly one layer — the
 * workspace's active one — and says which, in its heading. It used to carry a
 * target-layer `<select>` of its own, which let it point at a DIFFERENT layer
 * from the one the rest of the UI was describing; the layer list is now the
 * only place a layer is chosen.
 */

import { useCallback, useRef } from "react";
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
import {
  useRuleDraftStore,
  type RuleFormValues,
} from "../../features/rules/ruleDraftStore";
import { RULE_PRESETS } from "../../features/rules/presets";
import { NEW_RULE_COLOR_HEX } from "../../scene/cityColors";
import { downloadText } from "../../platform/download";

export interface RulesEditorProps {
  readonly model: CityModel;
  readonly layerId: string;
}

// Metric fields always available for conditions
const METRIC_FIELDS = [
  "areaSqM",
  "inclinationDeg",
  "azimuthDeg",
  "elevationM",
] as const;

const OPERATORS: ConditionOperator[] = [">", "<", "=", ">=", "<="];

export function RulesEditor({ model, layerId }: RulesEditorProps) {
  const layer = useLayerStore((s) => s.layers.find((l) => l.id === layerId));
  const rules = layer?.rules ?? [];
  const isStreaming = layer?.isStreaming ?? false;
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
  const allFields = [...METRIC_FIELDS, ...attributeFields];

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

  const openAddForm = useCallback(() => {
    setDraft(layerId, {
      editingId: null,
      open: true,
      form: defaultRuleFormValues(),
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
      }
      clearDraft(layerId);
    },
    [addRule, clearDraft, draft, layerId, updateRule],
  );

  const handleFormCancel = useCallback(() => {
    clearDraft(layerId);
  }, [clearDraft, layerId]);

  return (
    <>
      <div className="attr-section">
        {textureThemeActive && (
          <p className="rule-appearance-note" role="note">
            Texture theme active: rule colours show only on untextured surfaces.
            Pick "None" in the layer row's appearance dropdown to colour every
            surface.
          </p>
        )}

        <div className="rule-header">
          {/* The layer is NAMED here rather than assumed: rules are per-layer,
              and a tab that showed one layer's rules under a generic heading is
              how a user comes to apply Delft's colours to Rotterdam. */}
          <div className="attr-section-title">
            Rules &middot; {layer?.name ?? "no layer"}
          </div>
        </div>

        {rules.length === 0 && !showForm && (
          <div className="rule-empty">No rules defined. Add one below.</div>
        )}

        {rules.map((rule) => (
          <div key={rule.id}>
            {showForm && editingId === rule.id && draft !== null ? (
              <RuleForm
                values={draft.form}
                fields={allFields}
                saveLabel="Update"
                onChange={handleFormChange}
                onSave={handleFormSave}
                onCancel={handleFormCancel}
              />
            ) : (
              <RuleRow
                rule={rule}
                onEdit={() => openEditForm(rule)}
                onDelete={() => deleteRule(layerId, rule.id)}
                onToggle={() =>
                  updateRule(layerId, rule.id, { enabled: !rule.enabled })
                }
              />
            )}
          </div>
        ))}

        {showForm && editingId === null && draft !== null ? (
          <RuleForm
            values={draft.form}
            fields={allFields}
            saveLabel="Add"
            onChange={handleFormChange}
            onSave={handleFormSave}
            onCancel={handleFormCancel}
          />
        ) : (
          <button className="rule-add-btn" onClick={openAddForm}>
            + Add Rule
          </button>
        )}
      </div>

      {/* Preset rules */}
      <div className="attr-section">
        <div className="attr-section-title">Presets</div>
        <div className="preset-grid">
          {RULE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              className="preset-btn"
              title={preset.description}
              onClick={() => addRule(layerId, preset.create())}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Import / Export */}
      <div className="attr-section">
        <div className="attr-section-title">Import / Export</div>
        <div className="rule-io-row">
          <button
            className="rule-io-btn"
            onClick={handleExport}
            disabled={rules.length === 0}
          >
            Export rules
          </button>
          <button
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
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Rule Row (display mode)
// ---------------------------------------------------------------------------

function RuleRow({
  rule,
  onEdit,
  onDelete,
  onToggle,
}: {
  rule: Rule;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  return (
    <div className={`rule-item ${!rule.enabled ? "rule-disabled" : ""}`}>
      <div className="rule-swatch" style={{ background: rule.color }} />
      <div className="rule-info">
        <div className="rule-name">{rule.name}</div>
        <div className="rule-summary">
          {rule.conditions.length === 0
            ? "All roofs"
            : rule.conditions
                .map((c) => `${c.field} ${c.operator} ${c.value}`)
                .join(` ${rule.logic} `)}
        </div>
      </div>
      <div className="rule-actions">
        <button className="rule-action-btn" onClick={onToggle} title="Toggle">
          {rule.enabled ? "on" : "off"}
        </button>
        <button className="rule-action-btn" onClick={onEdit} title="Edit">
          edit
        </button>
        <button className="rule-action-btn" onClick={onDelete} title="Delete">
          del
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule Form (add/edit mode)
// ---------------------------------------------------------------------------

interface RuleFormProps {
  values: RuleFormValues;
  fields: string[];
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
 * what lets the draft survive this component unmounting when the active
 * layer changes (Task 27) — there is no local state here to lose.
 */
function RuleForm({
  values,
  fields,
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
          value={name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
        />
        <input
          type="color"
          className="rule-color-picker"
          value={color}
          onChange={(e) => onChange({ ...values, color: e.target.value })}
        />
      </div>

      {conditions.length > 1 && (
        <div className="rule-form-row">
          <select
            className="rule-select"
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
        <div key={idx} className="condition-row">
          <select
            className="rule-select"
            value={cond.field}
            onChange={(e) => updateCondition(idx, { field: e.target.value })}
          >
            {fields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            className="rule-select rule-select-sm"
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
              className="rule-action-btn"
              onClick={() => removeCondition(idx)}
            >
              x
            </button>
          )}
        </div>
      ))}

      <button className="rule-add-condition" onClick={addCondition}>
        + Condition
      </button>

      <div className="rule-form-actions">
        <button className="rule-save-btn" onClick={handleSave}>
          {saveLabel}
        </button>
        <button className="rule-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The "+ Add Rule" form's starting values — same defaults the old
 *  uncontrolled `RuleForm` seeded itself with when `initial` was absent. */
function defaultRuleFormValues(): RuleFormValues {
  return {
    name: "",
    color: NEW_RULE_COLOR_HEX,
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
