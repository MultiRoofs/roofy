import { useEffect, useId, useState, type InputHTMLAttributes } from "react";
import type { CandidateLoader } from "../../insights/filterCandidates";
export function FilterValueInput({
  column,
  load,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  column: string;
  load?: CandidateLoader;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [values, setValues] = useState<readonly string[]>([]);
  useEffect(() => {
    setValues([]);
    if (!focused || !load) return;
    let active = true;
    const timer = setTimeout(() => {
      void load(column).then(
        (result) => {
          if (active) setValues(result);
        },
        () => {
          if (active) setValues([]);
        },
      );
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [column, load, focused]);
  return (
    <>
      <input
        {...props}
        list={load ? id : undefined}
        title={
          load
            ? "Up to 20 suggestions from 10,000 source rows. Type any value; use Apply to filter."
            : props.title
        }
        onKeyDown={(event) => {
          // Native datalist owns Enter while suggestions are available.
          if (event.key === "Enter" && values.length > 0) return;
          props.onKeyDown?.(event);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
      />
      {load && (
        <datalist id={id}>
          {values.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      )}
    </>
  );
}
