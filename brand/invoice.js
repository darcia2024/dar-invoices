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

    window.copyAccount = function () {
        const number = document.body.dataset.account || "";
        navigator.clipboard.writeText(number).then(() => toast("Nomor rekening disalin"), () => toast(number));
    };
    window.printInvoice = function () { window.print(); };
})();
