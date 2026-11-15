// Applies the saved colour theme before first paint (external file so CSP can forbid inline scripts).
try { var t = localStorage.getItem("forge-theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch (e) { /* storage unavailable */ }
