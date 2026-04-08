/**
 * Rule builder tab for creating and managing per-layer colorization rules.
 *
 * Rules are stored in the layer store and applied to the mesh
 * via applyRuleColors in CityScene.
 */

import { useCallback, useRef, useState } from "react";
import type { CityModel } from "../../domain/citymodel/types";
import { useLayerStore } from "../../features/layers/layerStore";
import type { Condition, ConditionOperator, LogicMode, Rule } from "../../features/rules/types";
import { RULE_PRESETS } from "../../features/rules/presets";

interface RuleBuilderTabProps {
  readonly model: CityModel;
  readonly layerId: string;
}

// Metric fields always available for conditions
const METRIC_FIELDS = ["areaSqM", "inclinationDeg", "azimuthDeg", "elevationM"] as const;

const OPERATORS: ConditionOperator[] = [">", "<", "=", ">=", "<="];

export function RuleBuilderTab({ model, layerId }: RuleBuilderTabProps) {
  const layer = useLayerStore((s) => s.layers.find((l) => l.id === layerId));
  const rules = layer?.rules ?? [];
  const enabled = layer?.rulesEnabled ?? true;

  const addRule = useLayerStore((s) => s.addRule);
  const updateRule = useLayerStore((s) => s.updateRule);
  const deleteRule = useLayerStore((s) => s.deleteRule);
  const toggleRulesEnabled = useLayerStore((s) => s.toggleRulesEnabled);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  // Collect attribute fields from all objects for the field dropdown
  const attributeFields = collectAttributeFields(model);
  const allFields = [...METRIC_FIELDS, ...attributeFields];

  const handleExport = useCallback(() => {
    const json = JSON.stringify(rules, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rules.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [rules]);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      file.text().then((text) => {
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

  return (
    <>
      <div className="attr-section">
        <div className="rule-header">
          <div className="attr-section-title">Colorization Rules</div>
          <label className="rule-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={() => toggleRulesEnabled(layerId)}
            />
            <span className="rule-toggle-label">{enabled ? "On" : "Off"}</span>
          </label>
        </div>

        {rules.length === 0 && !showForm && (
          <div className="rule-empty">No rules defined. Add one below.</div>
        )}

        {rules.map((rule) => (
          <div key={rule.id}>
            {editingId === rule.id ? (
              <RuleForm
                initial={rule}
                fields={allFields}
                onSave={(updated) => {
                  updateRule(layerId, rule.id, updated);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <RuleRow
                rule={rule}
                onEdit={() => setEditingId(rule.id)}
                onDelete={() => deleteRule(layerId, rule.id)}
                onToggle={() => updateRule(layerId, rule.id, { enabled: !rule.enabled })}
              />
            )}
          </div>
        ))}

        {showForm ? (
          <RuleForm
            fields={allFields}
            onSave={(rule) => {
              addRule(layerId, {
                ...rule,
                id: crypto.randomUUID(),
              });
              setShowForm(false);
            }}
            onCancel={() => setShowForm(false)}
          />
        ) : (
          <button
            className="rule-add-btn"
            onClick={() => setShowForm(true)}
          >
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
  initial?: Rule;
  fields: string[];
  onSave: (rule: Rule) => void;
  onCancel: () => void;
}

function RuleForm({ initial, fields, onSave, onCancel }: RuleFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? "#4ec84e");
  const [logic, setLogic] = useState<LogicMode>(initial?.logic ?? "AND");
  const [conditions, setConditions] = useState<Condition[]>(
    initial ? [...initial.conditions] : [{ field: "inclinationDeg", operator: "<", value: 10 }],
  );

  const addCondition = () => {
    setConditions([...conditions, { field: "inclinationDeg", operator: "<", value: 0 }]);
  };

  const removeCondition = (idx: number) => {
    setConditions(conditions.filter((_, i) => i !== idx));
  };

  const updateCondition = (idx: number, patch: Partial<Condition>) => {
    setConditions(
      conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    );
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      id: initial?.id ?? "",
      name: name.trim(),
      color,
      logic,
      conditions,
      enabled: initial?.enabled ?? true,
    });
  };

  return (
    <div className="rule-form">
      <div className="rule-form-row">
        <input
          className="rule-input"
          placeholder="Rule name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="color"
          className="rule-color-picker"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </div>

      {conditions.length > 1 && (
        <div className="rule-form-row">
          <select
            className="rule-select"
            value={logic}
            onChange={(e) => setLogic(e.target.value as LogicMode)}
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
              updateCondition(idx, { operator: e.target.value as ConditionOperator })
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
                value: raw === "true" ? true : raw === "false" ? false : isNaN(num) ? raw : num,
              });
            }}
          />
          {conditions.length > 1 && (
            <button className="rule-action-btn" onClick={() => removeCondition(idx)}>
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
          {initial ? "Update" : "Add"}
        </button>
        <button className="rule-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
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
