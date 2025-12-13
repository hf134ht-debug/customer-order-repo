// ui.js : global press feedback (ripple) for buttons and pressables
(function(){
  function addRipple(el, x, y){
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.6;

    const span = document.createElement("span");
    span.className = "ripple";
    span.style.width = span.style.height = size + "px";
    span.style.left = (x - rect.left) + "px";
    span.style.top  = (y - rect.top) + "px";
    el.appendChild(span);

    span.addEventListener("animationend", ()=> span.remove(), { once:true });
  }

  function isTarget(el){
    if (!el) return false;
    if (el.closest("button")) return true;
    if (el.classList && (el.classList.contains("btn") || el.classList.contains("pressable"))) return true;
    if (el.classList && el.classList.contains("day")) return true; // calendar
    return false;
  }

  document.addEventListener("pointerdown", (ev)=>{
    const t = ev.target;
    if (!isTarget(t)) return;

    const el = t.closest("button") || t;
    // disabledは除外
    if (el.disabled) return;

    addRipple(el, ev.clientX, ev.clientY);
  }, { passive:true });
})();
