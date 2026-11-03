const toc = document.querySelector(".toc");

if (toc) {
  const wide = matchMedia("(min-width: 1100px)");
  const sync = () => {
    if (wide.matches) toc.open = true;
  };
  sync();
  wide.addEventListener("change", sync);

  const links = new Map(
    [...toc.querySelectorAll('a[href^="#"]')].map((link) => [
      decodeURIComponent(link.hash.slice(1)),
      link,
    ]),
  );
  const headings = [...links.keys()]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const mark = (id) => {
    for (const [key, link] of links) {
      if (key === id) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting);
      if (visible.length > 0) mark(visible[0].target.id);
    },
    { rootMargin: "0px 0px -70% 0px" },
  );
  headings.forEach((heading) => observer.observe(heading));
  toc.addEventListener("click", (event) => {
    if (event.target.closest("a") && !wide.matches) toc.open = false;
  });
}
