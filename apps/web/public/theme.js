try {
  const theme = JSON.parse(localStorage.getItem("axial.workspace.demo.v1") || "null")?.settings?.theme;
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {
  // An unavailable or invalid local preference leaves the system theme in control.
}
