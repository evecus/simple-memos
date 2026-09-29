(() => {
  const app = document.getElementById("app");

  const state = {
    status: null,
    user: null,
    memos: [],
    filter: { archived: false, tag: "", q: "", date: "" },
    pendingFiles: [],
    editingId: null,
    sidebarOpen: false,
    error: "",
    calMonth: (() => {
      const n = new Date();
      return { year: n.getFullYear(), month: n.getMonth() };
    })(),
  };

  // FULL FILE LOADED FROM LOCAL - see next message if truncated
  console.log("placeholder-replace");
})();
