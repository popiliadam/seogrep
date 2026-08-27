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
    // No card, or a kind this template cannot draw: keep the text answer visible and say so,
    // rather than painting an empty frame that looks like a broken card.
    if (!card || card.kind !== "metric") {
      text("sg-note", data.summary || "");
      reportSize();
      return;
    }
    drawMetric(card);
    text("sg-note", data.summary || "");
    reportSize();
  }

  window.addEventListener("message", function (event) {
    var message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.id === 1) { announce(); applyHostContext(message.result && message.result.hostContext); }
    if (message.method === "ui/notifications/host-context-changed") { applyHostContext(message.params); }
    if (message.method === "ui/notifications/tool-result") { announce(); draw(message.params); }
  });

  send({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} });
  setTimeout(announce, 400);
  setTimeout(reportSize, 0);
})();
`;
