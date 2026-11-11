// Shared invoice behaviour: PIN gate, copy account number, print/PDF.
// The page sets data-account="<number>" on <body>.
(function () {
    const PINS = ["0001", "050900"];
    const gate = document.getElementById("invGate");
    const input = document.getElementById("invPin");
    const err = document.getElementById("invPinErr");

    function unlock() {
        const value = (input.value || "").trim();
        if (PINS.includes(value)) {
            gate.classList.add("open");
            return;
        }
        err.textContent = "PIN salah";
        const card = gate.querySelector(".inv-gate-card");
        card.classList.remove("shake");
        void card.offsetWidth;
        card.classList.add("shake");
    }

    if (gate && input) {
        input.value = "";
        input.addEventListener("input", () => {
            err.textContent = "";
            if (PINS.includes(input.value.trim())) unlock();
        });
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") unlock(); });
        document.getElementById("invPinBtn").addEventListener("click", unlock);
    }

    function toast(text) {
        let el = document.querySelector(".inv-toast");
        if (!el) {
            el = document.createElement("div");
            el.className = "inv-toast";
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.classList.add("show");
        clearTimeout(el._t);
        el._t = setTimeout(() => el.classList.remove("show"), 2400);
    }

    function copy(number, label) {
        navigator.clipboard.writeText(number).then(() => toast(`${label} disalin`), () => toast(number));
    }
    window.copyAccount = function () {
        copy(document.body.dataset.account || "", "Nomor rekening");
    };
    // Each payment row: <button data-copy="number" data-label="Nomor Jago">Salin</button>
    document.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-copy]");
        if (btn) copy(btn.dataset.copy, btn.dataset.label || "Nomor");
    });
    window.printInvoice = function () { window.print(); };
})();
