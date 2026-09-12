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
    if (i === current && dots[i].classList.contains("active")) return;
    current = i;
    dots.forEach((d, j) => d.classList.toggle("active", j === i));
    counterCurrent.textContent = i + 1;
    advanceBtn.classList.toggle("hidden", i === slides.length - 1);
    const dark = slides[i].classList.contains("slide-dark");
    document.body.classList.toggle("on-dark", dark);
    document.body.classList.toggle("theater", dark); // scroll-linked light→obsidian bleed
    document.body.classList.toggle("pin-active", slides[i].classList.contains("pin-section"));
  }

  /* ---- Entrance animations ---- */
  const observer = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in-view")),
    { threshold: 0.15 }
  );
  slides.forEach((s) => observer.observe(s));

  /* ---- Tall scrub sections (horizontal timeline + pinned brain) ---- */
  const hs = document.querySelector(".hscroll");
  const hsTrack = hs && hs.querySelector(".hs-track");
  const hsViewport = hs && hs.querySelector(".hs-viewport");
  const hsFill = hs && hs.querySelector(".hs-progress-fill");
  const hsCardEls = hs ? Array.from(hs.querySelectorAll(".hs-card")) : [];
  const pin = document.querySelector(".pin-section");
  const pinFeatures = pin ? Array.from(pin.querySelectorAll(".pin-feature")) : [];

  function sectionProgress(el) {
    const scrollable = el.offsetHeight - window.innerHeight;
    if (scrollable <= 0) return 1;
    return Math.max(0, Math.min(1, (window.scrollY - el.offsetTop) / scrollable));
  }

  // steps the arrow keys take through a tall section
  function tallSteps(el) {
    if (el === hs) return hsCardEls.length - 1;
    if (el === pin) return pinFeatures.length;
    return 0;
  }

  function updateHscroll() {
    if (!hs) return;
    const prog = sectionProgress(hs);
    const span = hsTrack.scrollWidth - hsViewport.clientWidth;
    hsTrack.style.transform = `translate3d(${(-prog * Math.max(0, span)).toFixed(1)}px, 0, 0)`;
    hsFill.style.transform = `scaleX(${prog.toFixed(4)})`;
    // low-opacity focus: only the card nearest center is fully lit
    const active = Math.round(prog * (hsCardEls.length - 1));
    hsCardEls.forEach((c, i) => c.classList.toggle("hs-active", i === active));
  }

  function updatePin() {
    if (!pin) return;
    const prog = sectionProgress(pin);
    window.__pinProgress = document.body.classList.contains("pin-active") ? prog : null;
    // reading-spotlight: illuminate the feature the viewer is scrolled to
    const active = Math.min(pinFeatures.length - 1, Math.floor(prog * pinFeatures.length));
    pinFeatures.forEach((f, i) => f.classList.toggle("active", i === active));
  }

  /* ---- Scroll tracking: active slide + top progress bar ---- */
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const doc = document.documentElement;
      const overall = doc.scrollHeight > window.innerHeight
        ? window.scrollY / (doc.scrollHeight - window.innerHeight)
        : 1;
      barFill.style.transform = `scaleX(${overall.toFixed(4)})`;

      const cy = window.innerHeight / 2;
      for (let i = 0; i < slides.length; i++) {
        const r = slides[i].getBoundingClientRect();
        if (r.top <= cy && r.bottom > cy) {
          setCurrent(i);
          break;
        }
      }
      updateHscroll();
      updatePin();
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  /* ---- Keyboard navigation (steps through the horizontal timeline) ---- */
  function smoothScrollTo(top) {
    window.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
  }

  function tallOf(i) {
    const el = slides[i];
    return el && tallSteps(el) > 0 ? el : null;
  }

  function next() {
    const tall = tallOf(current);
    if (tall) {
      const scrollable = tall.offsetHeight - window.innerHeight;
      const pos = window.scrollY - tall.offsetTop;
      if (pos < scrollable - 4) {
        const step = scrollable / tallSteps(tall);
        smoothScrollTo(tall.offsetTop + Math.min(pos + step, scrollable));
        return;
      }
    }
    goTo(current + 1);
  }

  function prev() {
    const tall = tallOf(current);
    if (tall) {
      const pos = window.scrollY - tall.offsetTop;
      if (pos > 4) {
        const step = (tall.offsetHeight - window.innerHeight) / tallSteps(tall);
        smoothScrollTo(tall.offsetTop + Math.max(pos - step, 0));
        return;
      }
    }
    const above = tallOf(current - 1);
    if (above) {
      // entering a scrub section from below: land on its final beat
      smoothScrollTo(above.offsetTop + above.offsetHeight - window.innerHeight);
      return;
    }
    goTo(current - 1);
  }

  const NEXT_KEYS = ["ArrowDown", "ArrowRight", "PageDown", " ", "Spacebar"];
  const PREV_KEYS = ["ArrowUp", "ArrowLeft", "PageUp"];
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (NEXT_KEYS.includes(e.key)) {
      e.preventDefault();
      next();
    } else if (PREV_KEYS.includes(e.key)) {
      e.preventDefault();
      prev();
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

  advanceBtn.addEventListener("click", next);

  /* ---- Inversion cursor (fine pointers only) ---- */
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const dot = document.querySelector(".cursor-dot");
  const ring = document.querySelector(".cursor-ring");
  if (finePointer && dot && ring && !reducedMotion) {
    document.body.classList.add("custom-cursor");
    let mx = innerWidth / 2, my = innerHeight / 2;
    let rx = mx, ry = my;
    let shown = false;

    document.addEventListener("mousemove", (e) => {
      mx = e.clientX;
      my = e.clientY;
      if (!shown) {
        shown = true;
        dot.style.opacity = "1";
        ring.style.opacity = "1";
      }
      dot.style.transform = `translate(${mx}px, ${my}px)`;
    });
    document.addEventListener("mouseleave", () => {
      shown = false;
      dot.style.opacity = "0";
      ring.style.opacity = "0";
    });
    document.addEventListener("mouseover", (e) => {
      ring.classList.toggle("cursor-grow", !!e.target.closest("button, a, kbd"));
    });
    let ringScale = 1;
    (function follow() {
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      // grow via transform: scale() only — never width/height
      ringScale += ((ring.classList.contains("cursor-grow") ? 1.55 : 1) - ringScale) * 0.2;
      ring.style.transform = `translate(${rx.toFixed(1)}px, ${ry.toFixed(1)}px) scale(${ringScale.toFixed(3)})`;
      requestAnimationFrame(follow);
    })();
  } else {
    dot && dot.remove();
    ring && ring.remove();
  }
})();
