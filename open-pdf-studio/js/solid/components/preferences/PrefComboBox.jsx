import { createSignal, onCleanup } from 'solid-js';

export default function PrefComboBox(props) {
  const [open, setOpen] = createSignal(false);
  const [dropdownStyle, setDropdownStyle] = createSignal({});
  let wrapperRef;
  let dropdownRef;

  const options = props.options || [100, 80, 60, 40, 20];
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const suffix = props.suffix || '%';

  function handleDocClick(e) {
    if (wrapperRef && !wrapperRef.contains(e.target) &&
        dropdownRef && !dropdownRef.contains(e.target)) {
      setOpen(false);
    }
  }

  document.addEventListener('mousedown', handleDocClick);
  onCleanup(() => document.removeEventListener('mousedown', handleDocClick));

  const isDisabled = () => typeof props.disabled === 'function' ? props.disabled() : !!props.disabled;

  function handleInput(e) {
    if (isDisabled()) return;
    let val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      props.setValue(val);
    }
  }

  function handleBlur(e) {
    if (isDisabled()) return;
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = props.fallback ?? 100;
    val = Math.max(min, Math.min(max, val));
    props.setValue(val);
    e.target.value = val;
  }

  function selectOption(val) {
    if (isDisabled()) return;
    props.setValue(val);
    setOpen(false);
  }

  function positionDropdown() {
    if (!wrapperRef) return;
    const rect = wrapperRef.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 'px',
      left: (rect.left - 1) + 'px',
      width: (rect.width + 2) + 'px',
    });
  }

  function toggleDropdown(e) {
    e.preventDefault();
    if (isDisabled()) return;
    const willOpen = !open();
    if (willOpen) positionDropdown();
    setOpen(willOpen);
    if (willOpen && dropdownRef) {
      requestAnimationFrame(() => {
        const sel = dropdownRef.querySelector('.selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
      });
    }
  }

  return (
    <div class="pref-combo" classList={{ disabled: isDisabled() }} ref={wrapperRef}>
      <input
        type="text"
        class="pref-combo-input"
        value={props.value()}
        disabled={isDisabled()}
        onInput={handleInput}
        onBlur={handleBlur}
      />
      <span class="pref-combo-suffix">{suffix}</span>
      <button type="button" class="pref-combo-arrow" disabled={isDisabled()} onMouseDown={toggleDropdown}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      <div class="pref-combo-dropdown" classList={{ show: open() }}
        style={dropdownStyle()} ref={dropdownRef}>
        {options.map(opt => (
          <div
            class="pref-combo-option"
            classList={{ selected: props.value() === opt }}
            onMouseDown={() => selectOption(opt)}
          >
            {opt} {suffix}
          </div>
        ))}
      </div>
    </div>
  );
}
