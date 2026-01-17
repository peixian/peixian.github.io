let pages = [window.location.pathname];
let animationLength = 200;

function updateBreadcrumb() {
  const breadcrumb = document.getElementById("breadcrumb");
  if (!breadcrumb) return;

  const trailCrumbs = breadcrumb.querySelector(".trail-crumbs");
  if (!trailCrumbs) return;

  const container = document.querySelector(".grid");
  if (!container) return;

  const pageElements = container.querySelectorAll(".page");
  trailCrumbs.innerHTML = "";

  // Only show breadcrumb if there's more than one page
  if (pageElements.length <= 1) {
    breadcrumb.classList.remove("has-trail");
    return;
  }

  breadcrumb.classList.add("has-trail");

  pageElements.forEach((page, index) => {
    const h1 = page.querySelector("h1");
    const title = h1 ? h1.textContent.trim() : pages[index] || "Untitled";

    const crumb = document.createElement("span");
    crumb.className = "crumb";
    crumb.dataset.index = index;

    const link = document.createElement("a");
    link.href = "#";
    link.textContent = title;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      page.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // Hover on crumb highlights corresponding page
    crumb.addEventListener("mouseenter", () => {
      page.classList.add("hovered");
    });
    crumb.addEventListener("mouseleave", () => {
      page.classList.remove("hovered");
    });

    // Hover on page highlights corresponding crumb
    page.dataset.crumbIndex = index;
    page.addEventListener("mouseenter", handlePageHover);
    page.addEventListener("mouseleave", handlePageLeave);

    crumb.appendChild(link);
    trailCrumbs.appendChild(crumb);
  });

  // Scroll to end to show most recent
  trailCrumbs.scrollLeft = trailCrumbs.scrollWidth;
}

function handlePageHover(e) {
  const page = e.currentTarget;
  const index = page.dataset.crumbIndex;
  const crumb = document.querySelector(`.trail-crumbs .crumb[data-index="${index}"]`);
  if (crumb) crumb.classList.add("active");
}

function handlePageLeave(e) {
  const page = e.currentTarget;
  const index = page.dataset.crumbIndex;
  const crumb = document.querySelector(`.trail-crumbs .crumb[data-index="${index}"]`);
  if (crumb) crumb.classList.remove("active");
}

function stackNote(href, level) {
  level = Number(level) || pages.length;
  href = URI(href);
  const uri = URI(window.location);
  pages.push(href.path());
  uri.setQuery("stackedNotes", pages.slice(1, pages.length));

  const old_pages = pages.slice(0, level - 1);
  const state = { pages: old_pages, level: level };
  window.history.pushState(state, "", uri.href());
}

function unstackNotes(level) {
  const container = document.querySelector(".grid");
  const children = Array.prototype.slice.call(container.children);

  for (let i = level; i < children.length; i++) {
    container.removeChild(children[i]);
  }
  pages = pages.slice(0, level);
  updateBreadcrumb();
}

function updateLinkStatuses() {
  const links = document.querySelectorAll("a");
  links.forEach(function (e) {
    if (pages.indexOf(e.getAttribute("href")) > -1) {
      e.classList.add("active");
    } else {
      e.classList.remove("active");
    }
  });
}

// Check if link is internal and should open in stacked pane
function isInternalLink(href) {
  if (!href) return false;
  return !(
    href.indexOf("http://") === 0 ||
    href.indexOf("https://") === 0 ||
    href.indexOf("#") === 0 ||
    href.includes(".pdf") ||
    href.includes(".svg")
  );
}

// Fetches note at href, and then removes all notes up to level, and inserts the new note
function fetchNote(href, level) {
  if (pages.indexOf(href) > -1) return;
  level = Number(level) || pages.length;

  fetch(href)
    .then((response) => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.text();
    })
    .then((text) => {
      unstackNotes(level);
      const container = document.querySelector(".grid");
      const fragment = document.createElement("template");
      fragment.innerHTML = text;
      const element = fragment.content.querySelector(".page");
      if (!element) return;

      container.appendChild(element);
      stackNote(href, level);

      // Update TOC
      const newToc = fragment.content.querySelector(".toc-sidebar");
      const currentToc = document.querySelector(".toc-sidebar");
      if (currentToc) {
        if (newToc) {
          currentToc.innerHTML = newToc.innerHTML;
          currentToc.style.display = "";
        } else {
          currentToc.innerHTML = "";
          currentToc.style.display = "none";
        }
      }

      // Initialize the new page after a brief delay
      requestAnimationFrame(() => {
        element.dataset.level = level + 1;
        initializePage(element, level + 1);
        updateBreadcrumb();
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (typeof renderMathInElement === 'function') {
          renderMathInElement(element);
        }
      });
    })
    .catch((error) => {
      console.error('Error fetching note:', error);
    });
}

function initializePage(page, level) {
  level = level || pages.length;

  const links = page.querySelectorAll("a");

  links.forEach(function (element) {
    const rawHref = element.getAttribute("href");
    element.dataset.level = level;

    if (isInternalLink(rawHref)) {
      // Add click handler for stacked navigation
      element.addEventListener("click", function (e) {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          fetchNote(element.getAttribute("href"), this.dataset.level);
        }
      });

      // Prefetch on hover (more efficient than prefetching all)
      let prefetched = false;
      element.addEventListener("mouseenter", function () {
        if (prefetched) return;
        prefetched = true;

        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = element.href;
        link.as = 'document';
        document.head.appendChild(link);
      }, { once: true });
    }
  });

  updateLinkStatuses();
}

window.addEventListener("popstate", function (event) {
  // Reload on back/forward navigation
  window.location = window.location;
});

// Use DOMContentLoaded instead of window.onload for faster initialization
document.addEventListener("DOMContentLoaded", function () {
  const firstPage = document.querySelector(".page");
  if (firstPage) {
    initializePage(firstPage);
  }

  // Handle stacked notes from URL
  const uri = URI(window.location);
  if (uri.hasQuery("stackedNotes")) {
    let stacks = uri.query(true).stackedNotes;
    if (!Array.isArray(stacks)) {
      stacks = [stacks];
    }
    stacks.forEach((stack, i) => {
      fetchNote(stack, i + 1);
    });
  }
});
