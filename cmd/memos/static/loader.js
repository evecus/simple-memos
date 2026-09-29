Promise.all([
  fetch('/app.p0.js').then(r => r.text()),
  fetch('/app.p1.js').then(r => r.text()),
  fetch('/app.css').then(r => r.text()),
]).then(([p0, p1, css]) => {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  (0, eval)(p0 + p1);
}).catch(e => {
  const el = document.getElementById('app');
  if (el) el.innerHTML = '<div style="padding:48px;text-align:center;color:#c00">' + e + '</div>';
  console.error(e);
});
