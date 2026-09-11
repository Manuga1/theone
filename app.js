(() => {
  const slides = Array.from(document.querySelectorAll(".slide"));
  const dotsNav = document.querySelector(".dots");
  const barFill = document.querySelector(".progress-bar-fill");
  const counterCurrent = document.querySelector(".slide-counter .current");
  const counterTotal = document.querySelector(".slide-counter .total");
  const advanceBtn = document.querySelector(".advance");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  counterTotal.textContent = slides.length;

  /* ---- Progress dots ---- */
  slides.forEach((slide, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.setAttribute("aria-label", `Go to slide ${i + 1}`);
    dot.addEventListener("click", () => goTo(i));
    dotsNav.appendChild(dot);
  });
  const dots = Array.from(dotsNav.children);

  let current = 0;

  function goTo(i) {
    const target = Math.max(0, Math.min(slides.length - 1, i));
    slides[target].scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  }

  function setCurrent(i) {
    current = i;
    dots.forEach((d, j) => d.classList.toggle("active", j === i));
    counterCurrent.textContent = i + 1;
    barFill.style.width = `${((i + 1) / slides.length) * 100}%`;
    advanceBtn.classList.toggle("hidden", i === slides.length - 1);
    document.body.classList.toggle("on-dark", slides[i].classList.contains("slide-divider"));
  }

  /* ---- Observe slides: entrance animations + active tracking ---- */
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          setCurrent(slides.indexOf(entry.target));
        }
      });
    },
    { threshold: 0.55 }
  );
  slides.forEach((s) => observer.observe(s));

  /* ---- Keyboard navigation ---- */
  const NEXT_KEYS = ["ArrowDown", "ArrowRight", "PageDown", " ", "Spacebar"];
  const PREV_KEYS = ["ArrowUp", "ArrowLeft", "PageUp"];
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (NEXT_KEYS.includes(e.key)) {
      e.preventDefault();
      goTo(current + 1);
    } else if (PREV_KEYS.includes(e.key)) {
      e.preventDefault();
      goTo(current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      goTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      goTo(slides.length - 1);
    } else if (e.key.toLowerCase() === "n") {
      document.body.classList.toggle("show-notes");
    }
  });

  advanceBtn.addEventListener("click", () => goTo(current + 1));

  /* ---- Animated network background (title + close slides) ---- */
  if (!reducedMotion) {
    document.querySelectorAll("[data-canvas] .net-canvas").forEach(initNetwork);
  }

  function initNetwork(canvas) {
    const ctx = canvas.getContext("2d");
    const isDark = canvas.closest(".slide-divider") !== null;
    let nodes = [];
    let w = 0;
    let h = 0;
    let raf = null;

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(24, Math.min(64, Math.floor((w * h) / 26000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: 1.5 + Math.random() * 2,
      }));
    }

    function tick() {
      ctx.clearRect(0, 0, w, h);
      const linkDist = Math.min(w, h) * 0.22;
      const stroke = isDark ? "255,255,255" : "15,118,110";
      const fill = isDark ? "255,255,255" : "3,105,161";

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        a.x += a.vx;
        a.y += a.vy;
        if (a.x < 0 || a.x > w) a.vx *= -1;
        if (a.y < 0 || a.y > h) a.vy *= -1;

        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < linkDist) {
            ctx.strokeStyle = `rgba(${stroke},${(0.16 * (1 - dist / linkDist)).toFixed(3)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      for (const n of nodes) {
        ctx.fillStyle = `rgba(${fill},0.35)`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    }

    /* Only animate while the slide is on screen */
    const vis = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && raf === null) {
            raf = requestAnimationFrame(tick);
          } else if (!entry.isIntersecting && raf !== null) {
            cancelAnimationFrame(raf);
            raf = null;
          }
        });
      },
      { threshold: 0.05 }
    );

    resize();
    window.addEventListener("resize", resize);
    raf = null;
    vis.observe(canvas.closest(".slide"));
  }
})();
