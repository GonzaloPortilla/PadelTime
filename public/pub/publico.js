// Padel Time · vista pública. Filtro instantáneo del ranking (la página funciona igual sin JavaScript).
(function () {
  var input = document.querySelector("[data-filter]");
  var table = document.getElementById("ranking");
  if (!input || !table) return;
  var rows = table.querySelectorAll("tbody tr");
  var empty = document.querySelector("[data-empty]");
  var norm = function (s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  };
  var apply = function () {
    var q = norm(input.value);
    var shown = 0;
    for (var i = 0; i < rows.length; i++) {
      var match = !q || (rows[i].getAttribute("data-name") || "").indexOf(q) !== -1;
      rows[i].hidden = !match;
      if (match) shown++;
    }
    if (empty) empty.hidden = shown !== 0;
  };
  input.addEventListener("input", apply);
  input.form && input.form.addEventListener("submit", function (e) {
    e.preventDefault();
    apply();
  });
  apply();
})();
