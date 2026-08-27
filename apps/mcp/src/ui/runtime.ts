/**
 * The JavaScript that runs inside the host's sandboxed iframe.
 *
 * IT IS A STRING, and the reason is structural rather than stylistic: the template is
 * PREDECLARED and static (the host prefetches and caches it), while the data arrives afterwards
 * over postMessage. So the card is drawn in the browser, and this is the only place that code can
 * live. It is exercised for real in card-dom.test.ts under jsdom rather than matched as a string
 * — a string pin over drawing code is the shape this repo has signed a lesson about.
 *
 * NO BACKTICKS BELOW. This string is itself a template literal; a backtick in a comment closes it
 * and the lint gate goes red with a parse error two lines later (measured 2026-08-27).
 *
 * THE HANDSHAKE IS DEFENSIVE. The spec has the view send ui/initialize, await the result, then
 * announce ui/notifications/initialized. A view that BLOCKED on that result would render nothing
 * against a host that answers differently than we read the spec — and "never rendered" and "the
 * handshake is wrong" look identical from outside. So the card paints immediately, announces on
 * the response OR after a short timer, and draws on any tool-result it sees.
 */
export const VIEW_SCRIPT = `
(function () {
  var host = window.parent;
  var announced = false;
  var lastHeight = 0;
  var sizeTimer = null;

  function send(message) { try { host.postMessage(message, "*"); } catch (e) {} }

  function announce() {
    if (announced) return;
    announced = true;
    send({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
  }

  function applyHostContext(context) {
    if (!context) return;
    if (context.theme === "dark" || context.theme === "light") {
      document.documentElement.setAttribute("data-theme", context.theme);
    }
    // Host variables are applied VERBATIM and nothing here references one by name: the extension
    // does not fix those names and Claude's have not been measured. Writing them keeps a later
    // slice able to use them once they are known, without this one inventing a convention.
    var variables = context.styles && context.styles.variables;
    if (variables) {
      for (var name in variables) {
        if (name.indexOf("--") === 0) document.documentElement.style.setProperty(name, variables[name]);
      }
    }
    var fonts = context.styles && context.styles.css && context.styles.css.fonts;
    if (typeof fonts === "string" && fonts.length > 0) {
      var sheet = document.getElementById("sg-host-fonts");
      if (sheet) sheet.textContent = fonts;
    }
    reportSize();
  }

  function reportSize() {
    var height = Math.ceil(document.documentElement.scrollHeight);
    if (height === lastHeight) return;
    lastHeight = height;
    send({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: height } });
  }

  // A REFLOW TRIGGER, not just a measurement: reportSize() only reads the current height, it does
  // not know when to read it again. Two things resize this card after the point-in-time calls
  // below have already run: host fonts arriving asynchronously (applyHostContext writes them
  // synchronously, but the @font-face swap and its reflow happen later) and content rewrapping on
  // a viewport change. Debounced so a burst of layout changes reports once.
  function scheduleSize() {
    if (sizeTimer !== null) clearTimeout(sizeTimer);
    sizeTimer = setTimeout(function () { sizeTimer = null; reportSize(); }, 50);
  }

  function text(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function factRow(fact) {
    var tr = document.createElement("tr");
    var th = document.createElement("th");
    th.textContent = fact.label;
    var td = document.createElement("td");
    td.textContent = fact.value;
    tr.appendChild(th);
    tr.appendChild(td);
    return tr;
  }

  function drawMetric(card) {
    text("sg-title", card.title);
    text("sg-value", card.value);
    text("sg-unit", card.unit || "");
    text("sg-badge", card.badge || "live");
    var body = document.getElementById("sg-facts");
    if (!body) return;
    body.textContent = "";
    var facts = card.facts || [];
    for (var i = 0; i < facts.length; i++) body.appendChild(factRow(facts[i]));
  }

  function draw(params) {
    var data = (params && params.structuredContent) || {};
    var card = data.card;
    // The sentence: structuredContent.summary when present, otherwise the first text content
    // block. errorResult carries content and NO structuredContent (registry.ts) — a host that
    // delivers that tool-result here must still show the customer why the card is empty, not a
    // blank note. Reading only data.summary was the regression this fallback closes: it read
    // '{}' from a missing structuredContent and painted an empty sg-note next to an empty card.
    var blocks = (params && params.content) || [];
    var sentence = data.summary || (blocks.length && blocks[0] && blocks[0].text ? blocks[0].text : "");
    // No card, or a kind this template cannot draw: keep the text answer visible and say so,
    // rather than painting an empty frame that looks like a broken card. Also CLEAR whatever a
    // PREVIOUS metric result drew here — otherwise a metric-then-non-metric sequence leaves the
    // old title/value/unit/facts sitting beside the new summary. The badge moves off "waiting":
    // that word is reserved for before any result has arrived, not for "this result has no card".
    if (!card || card.kind !== "metric") {
      text("sg-title", "");
      text("sg-value", "—");
      text("sg-unit", "");
      text("sg-badge", "text");
      var facts = document.getElementById("sg-facts");
      if (facts) facts.textContent = "";
      text("sg-note", sentence);
      reportSize();
      return;
    }
    drawMetric(card);
    text("sg-note", sentence);
    reportSize();
  }

  window.addEventListener("message", function (event) {
    var message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.id === 1) { announce(); applyHostContext(message.result && message.result.hostContext); }
    if (message.method === "ui/notifications/host-context-changed") { applyHostContext(message.params); }
    if (message.method === "ui/notifications/tool-result") { announce(); draw(message.params); }
  });

  // typeof-GUARDED: jsdom, the environment the next task's card-dom.test.ts runs this script
  // under, has no ResizeObserver. An unguarded "new ResizeObserver" would throw at script load
  // and take the whole handshake down with it — do not "clean this up" into a bare constructor
  // call.
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(scheduleSize).observe(document.documentElement);
  }
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(scheduleSize);
  }

  send({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} });
  setTimeout(announce, 400);
  setTimeout(reportSize, 0);
})();
`;
