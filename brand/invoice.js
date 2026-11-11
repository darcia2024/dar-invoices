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

    // Optional add-ons: <section class="inv-addons" data-base="650000" data-wa="62813..."> with
    // <label class="addon"><input type="checkbox" data-price="200000" data-name="Domain .com 1 tahun">…</label>.
    // Ticking one updates the total, the words under it, and a WhatsApp confirmation link.
    const addons = document.querySelector(".inv-addons");
    if (addons) {
        const base = Number(addons.dataset.base) || 0;
        const totalEl = document.querySelector(".inv-total strong");
        const labelEl = document.querySelector(".inv-total span");
        const wordsEl = document.querySelector(".inv-words");
        const confirm = document.querySelector(".inv-confirm");
        const confirmLink = confirm && confirm.querySelector("a");
        const invoiceNo = (document.querySelector(".inv-title .no") || {}).textContent || "";
        const rupiah = (n) => "Rp " + n.toLocaleString("id-ID");
        const words = (n) => {
            const units = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
            const say = (x) => {
                if (x < 12) return units[x];
                if (x < 20) return say(x - 10) + " belas";
                if (x < 100) return say(Math.floor(x / 10)) + " puluh" + (x % 10 ? " " + say(x % 10) : "");
                if (x < 200) return "seratus" + (x - 100 ? " " + say(x - 100) : "");
                if (x < 1000) return say(Math.floor(x / 100)) + " ratus" + (x % 100 ? " " + say(x % 100) : "");
                if (x < 2000) return "seribu" + (x - 1000 ? " " + say(x - 1000) : "");
                if (x < 1e6) return say(Math.floor(x / 1000)) + " ribu" + (x % 1000 ? " " + say(x % 1000) : "");
                if (x < 1e9) return say(Math.floor(x / 1e6)) + " juta" + (x % 1e6 ? " " + say(x % 1e6) : "");
                return say(Math.floor(x / 1e9)) + " miliar" + (x % 1e9 ? " " + say(x % 1e9) : "");
            };
            return n ? say(n) + " rupiah" : "nol rupiah";
        };
        const refresh = () => {
            const picked = [...addons.querySelectorAll("input[type=checkbox]")].filter((i) => i.checked);
            addons.querySelectorAll(".addon").forEach((row) => row.classList.toggle("on", row.querySelector("input").checked));
            addons.classList.toggle("has-on", picked.length > 0);
            const extra = picked.reduce((sum, i) => sum + Number(i.dataset.price || 0), 0);
            totalEl.textContent = rupiah(base + extra);
            labelEl.innerHTML = picked.length ? "Total<small class=\"with\">termasuk " + picked.length + " add-on</small>" : "Total";
            if (wordsEl) wordsEl.textContent = words(base + extra);
            if (confirm && confirmLink) {
                confirm.classList.toggle("show", picked.length > 0);
                const text = `Halo, untuk invoice ${invoiceNo.trim()} saya mau tambah:\n` +
                    picked.map((i) => `- ${i.dataset.name} (${rupiah(Number(i.dataset.price))})`).join("\n") +
                    `\nTotal jadi ${rupiah(base + extra)}.`;
                confirmLink.href = `https://wa.me/${addons.dataset.wa}?text=${encodeURIComponent(text)}`;
            }
        };
        addons.addEventListener("change", refresh);
        refresh();
    }
})();
