if (window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/")) {
  initAdmin();
} else {
  initPublic();
}
