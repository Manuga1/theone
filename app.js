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
    document.body.classList.toggle("on-dark", slides[i].classList.contains("slide-divider"));
  }

  /* ---- Entrance animations ---- */
  const observer = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in-view")),
    { threshold: 0.15 }
  );
  slides.forEach((s) => observer.observe(s));

  /* ---- Horizontal section scroller ---- */
  const hs = document.querySelector(".hscroll");
  const hsTrack = hs && hs.querySelector(".hs-track");
  const hsViewport = hs && hs.querySelector(".hs-viewport");
  const hsFill = hs && hs.querySelector(".hs-progress-fill");
  const hsCards = hs ? hs.querySelectorAll(".hs-card").length : 0;
  const hsIndex = hs ? slides.indexOf(hs) : -1;

  function hsScrollable() {
    return hs.offsetHeight - window.innerHeight;
  }

  function updateHscroll() {
    if (!hs) return;
    const scrollable = hsScrollable();
    if (scrollable <= 0) return;
    const pos = window.scrollY - hs.offsetTop;
    const prog = Math.max(0, Math.min(1, pos / scrollable));
    const span = hsTrack.scrollWidth - hsViewport.clientWidth;
    hsTrack.style.transform = `translate3d(${(-prog * Math.max(0, span)).toFixed(1)}px, 0, 0)`;
    hsFill.style.width = `${(prog * 100).toFixed(2)}%`;
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
      barFill.style.width = `${(overall * 100).toFixed(2)}%`;

      const cy = window.innerHeight / 2;
      for (let i = 0; i < slides.length; i++) {
        const r = slides[i].getBoundingClientRect();
        if (r.top <= cy && r.bottom > cy) {
          setCurrent(i);
          break;
        }
      }
      updateHscroll();
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  /* ---- Keyboard navigation (steps through the horizontal timeline) ---- */
  function smoothScrollTo(top) {
    window.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
  }

  function next() {
    if (current === hsIndex) {
      const scrollable = hsScrollable();
      const pos = window.scrollY - hs.offsetTop;
      if (pos < scrollable - 4) {
        const step = scrollable / (hsCards - 1);
        smoothScrollTo(hs.offsetTop + Math.min(pos + step, scrollable));
        return;
      }
    }
    goTo(current + 1);
  }

  function prev() {
    if (current === hsIndex) {
      const pos = window.scrollY - hs.offsetTop;
      if (pos > 4) {
        const step = hsScrollable() / (hsCards - 1);
        smoothScrollTo(hs.offsetTop + Math.max(pos - step, 0));
        return;
      }
    }
    if (current - 1 === hsIndex) {
      // entering the timeline from below: land on its last card
      smoothScrollTo(hs.offsetTop + hsScrollable());
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
    (function follow() {
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      ring.style.transform = `translate(${rx.toFixed(1)}px, ${ry.toFixed(1)}px)`;
      requestAnimationFrame(follow);
    })();
  } else {
    dot && dot.remove();
    ring && ring.remove();
  }
})();
