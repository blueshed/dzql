import { useWs } from "zeroql/client";


const ws = useWs();
let isAuthenticated = false;
let eventHistory = [];
let userProfile = null;

// Connect on page load
ws.connect();

// Update connection status
function updateStatus() {
  const statusEl = document.getElementById("status");
  if (ws.isConnected()) {
    statusEl.textContent = isAuthenticated
      ? "Connected & Authenticated"
      : "Connected (Not Authenticated)";
    statusEl.className = "status connected";
  } else {
    statusEl.textContent = "Disconnected";
    statusEl.className = "status disconnected";
  }
}

setInterval(updateStatus, 1000);

// Listen for real-time events
ws.onBroadcast((method, params) => {
  // Handle connection status updates
  if (method === "connected") {
    isAuthenticated = params.authenticated || false;
    userProfile = params.profile || null;
    console.log(`Connected: authenticated=${isAuthenticated}`, userProfile);
    return;
  }

  const timestamp = new Date().toLocaleTimeString();
  const event = {
    timestamp,
    method,
    params,
  };

  eventHistory.push(event);

  // Keep only last 50 events to prevent memory issues
  if (eventHistory.length > 50) {
    eventHistory = eventHistory.slice(-50);
  }

  renderEvents();
});

// Render events list
function renderEvents() {
  const eventsEl = document.getElementById("events");

  if (eventHistory.length === 0) {
    eventsEl.innerHTML = '<div class="no-events">No events yet...</div>';
    return;
  }

  const eventsHtml = eventHistory
    .map(
      (event) => `
        <div class="event-item">
            <div class="event-header">
                <span class="event-timestamp">[${event.timestamp}]</span>
                <span class="event-method">${event.method}</span>
            </div>
            <div class="event-params">
                <pre>${JSON.stringify(event.params, null, 2)}</pre>
            </div>
        </div>
    `,
    )
    .join("");

  eventsEl.innerHTML = eventsHtml;
  eventsEl.scrollTop = eventsEl.scrollHeight;
}

// Authentication functions
window.register = async function () {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    const result = await ws.call("register_user", {
      email,
      password,
    });
    document.getElementById("auth-result").innerHTML =
      `<div class="result">${JSON.stringify(result, null, 2)}</div>`;
    if (result.token) {
      localStorage.setItem("zeroql_token", result.token);
      isAuthenticated = true;
      userProfile = result.profile;
    }
  } catch (error) {
    document.getElementById("auth-result").innerHTML =
      `<div class="error">${error.message}</div>`;
  }
};

window.login = async function () {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    const result = await ws.call("login_user", {
      email,
      password,
    });
    document.getElementById("auth-result").innerHTML =
      `<div class="result">${JSON.stringify(result, null, 2)}</div>`;
    if (result.token) {
      localStorage.setItem("zeroql_token", result.token);
      isAuthenticated = true;
      userProfile = result.profile;
    }
  } catch (error) {
    document.getElementById("auth-result").innerHTML =
      `<div class="error">${error.message}</div>`;
  }
};

window.logout = async function () {
  try {
    await ws.call("logout");
    localStorage.removeItem("zeroql_token");
    isAuthenticated = false;
    userProfile = null;
    document.getElementById("auth-result").innerHTML =
      '<div class="result">Logged out successfully</div>';
  } catch (error) {
    document.getElementById("auth-result").innerHTML =
      `<div class="error">${error.message}</div>`;
  }
};

// ZeroQL API Examples using new nested proxy syntax
window.testGet = async function () {
  try {
    // NEW: api.get.organisations() instead of ws.call('zeroql.get.organisations')
    const result = await ws.api.get.organisations({ id: 1 });
    document.getElementById("get-result").innerHTML =
      `<div class="result">${JSON.stringify(result, null, 2)}</div>`;
  } catch (error) {
    document.getElementById("get-result").innerHTML =
      `<div class="error">${error.message}</div>`;
  }
};

window.testGetVenue = async function () {
  try {
    const result = await ws.api.get.venues({ id: 1 });
    document.getElementById("get-result").innerHTML =
      `<div class="result">${JSON.stringify(result, null, 2)}</div>`;
  } catch (error) {
    document.getElementById("get-result").innerHTML =
      `<div class="error">${error.message}</div>`;
  }
};

window.testLookup = async function () {
  const filter = document.getElementById("lookup-filter").value || "";
  try {
    const result = await ws.api.lookup.organisations({
      p_filter: filter,
    });
    document.getElementById("lookup-result").innerHTML =
      `<div class="result">${JSON.stringify(result, null, 2)}</div>`;
  } catch (error) {
    document.getElementById("lookup-result").innerHTML =
      `<div class="error">${error.message}</div>`;
  }
};

// Enhanced search functionality with filters
let filterCount = 0;

window.addFilter = function () {
  const container = document.getElementById("filters-container");
  const filterId = `filter-${filterCount++}`;

  const filterRow = document.createElement("div");
  filterRow.className = "filter-row";
  filterRow.id = filterId;

  filterRow.innerHTML = `
    <input type="text" placeholder="Field name" class="filter-field" />
    <select class="filter-operator">
      <option value="eq">Equals (=)</option>
      <option value="neq">Not Equals (≠)</option>
      <option value="gt">Greater Than (>)</option>
      <option value="gte">Greater or Equal (≥)</option>
      <option value="lt">Less Than (<)</option>
      <option value="lte">Less or Equal (≤)</option>
      <option value="between">Between</option>
      <option value="like">Like (%pattern%)</option>
      <option value="ilike">Case-insensitive Like</option>
      <option value="in">IN (array)</option>
      <option value="not_in">NOT IN</option>
      <option value="null">IS NULL</option>
      <option value="not_null">IS NOT NULL</option>
    </select>
    <input type="text" placeholder="Value" class="filter-value" />
    <button onclick="removeFilter('${filterId}')" class="btn-remove">✕</button>
  `;

  container.appendChild(filterRow);
  updateSearchPreview();
};

window.removeFilter = function (filterId) {
  const element = document.getElementById(filterId);
  if (element) {
    element.remove();
    updateSearchPreview();
  }
};

window.loadExample = function (example) {
  // Clear existing filters
  document.getElementById("filters-container").innerHTML = "";
  filterCount = 0;

  switch (example) {
    case "expensive":
      document.getElementById("search-entity").value = "products";
      addFilter();
      const expFilter = document.querySelector(".filter-row:last-child");
      expFilter.querySelector(".filter-field").value = "price";
      expFilter.querySelector(".filter-operator").value = "gt";
      expFilter.querySelector(".filter-value").value = "2000";
      break;

    case "brooklyn":
      document.getElementById("search-entity").value = "venues";
      document.getElementById("search-text").value = "brooklyn";
      break;

    case "led":
      document.getElementById("search-entity").value = "products";
      document.getElementById("search-text").value = "LED";
      addFilter();
      const ledFilter = document.querySelector(".filter-row:last-child");
      ledFilter.querySelector(".filter-field").value = "description";
      ledFilter.querySelector(".filter-operator").value = "not_null";
      break;

    case "range":
      document.getElementById("search-entity").value = "products";
      addFilter();
      const rangeFilter = document.querySelector(".filter-row:last-child");
      rangeFilter.querySelector(".filter-field").value = "price";
      rangeFilter.querySelector(".filter-operator").value = "between";
      rangeFilter.querySelector(".filter-value").value = "500, 2000";
      break;
  }

  updateSearchPreview();
};

function buildFilters() {
  const filters = {};

  // Add text search if present
  const searchText = document.getElementById("search-text").value.trim();
  if (searchText) {
    filters._search = searchText;
  }

  // Add all filter rows
  const filterRows = document.querySelectorAll(".filter-row");
  filterRows.forEach((row) => {
    const field = row.querySelector(".filter-field").value.trim();
    const operator = row.querySelector(".filter-operator").value;
    const value = row.querySelector(".filter-value").value.trim();

    if (!field) return;

    // Handle different operators
    switch (operator) {
      case "eq":
        filters[field] = isNaN(value) ? value : Number(value);
        break;
      case "null":
        filters[field] = null;
        break;
      case "not_null":
        filters[field] = { not_null: true };
        break;
      case "between":
        const [min, max] = value.split(",").map((v) => Number(v.trim()));
        filters[field] = { between: [min, max] };
        break;
      case "in":
      case "not_in":
        const values = value.split(",").map((v) => {
          const trimmed = v.trim();
          return isNaN(trimmed) ? trimmed : Number(trimmed);
        });
        filters[field] = operator === "in" ? values : { not_in: values };
        break;
      default:
        if (value) {
          filters[field] = { [operator]: isNaN(value) ? value : Number(value) };
        }
    }
  });

  return filters;
}

function updateSearchPreview() {
  const entity = document.getElementById("search-entity").value;
  const filters = buildFilters();
  const sortField = document.getElementById("sort-field").value.trim();
  const sortOrder = document.getElementById("sort-order").value;
  const page = parseInt(document.getElementById("page-num").value) || 1;
  const limit = parseInt(document.getElementById("page-limit").value) || 10;
  const onDate = document.getElementById("on-date").value;

  const params = { filters };

  if (sortField) {
    params.sort = { field: sortField, order: sortOrder };
  }

  params.page = page;
  params.limit = limit;

  if (onDate) {
    params.on_date = onDate;
  }

  const preview = `api.search.${entity}(${JSON.stringify(params, null, 2)})`;
  document.getElementById("search-preview").textContent = preview;
}

window.executeSearch = async function () {
  const entity = document.getElementById("search-entity").value;
  const filters = buildFilters();
  const sortField = document.getElementById("sort-field").value.trim();
  const sortOrder = document.getElementById("sort-order").value;
  const page = parseInt(document.getElementById("page-num").value) || 1;
  const limit = parseInt(document.getElementById("page-limit").value) || 10;
  const onDate = document.getElementById("on-date").value;

  const params = { filters };

  if (sortField) {
    params.sort = { field: sortField, order: sortOrder };
  }

  params.page = page;
  params.limit = limit;

  if (onDate) {
    params.on_date = onDate;
  }

  try {
    // Call the appropriate entity search method
    const result = await ws.api.search[entity](params);

    // Show stats
    const statsEl = document.getElementById("search-stats");
    statsEl.innerHTML = `
      Found ${result.total} results •
      Page ${result.page} of ${Math.ceil(result.total / result.limit)} •
      Showing ${result.data.length} items
    `;
    statsEl.classList.add("visible");

    // Format results as table
    if (result.data.length > 0) {
      const headers = Object.keys(result.data[0]);
      const tableHtml = `
        <table>
          <thead>
            <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${result.data
              .map(
                (row) => `
              <tr>${headers.map((h) => `<td>${formatValue(row[h])}</td>`).join("")}</tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      `;
      document.getElementById("search-result").innerHTML = tableHtml;
    } else {
      document.getElementById("search-result").innerHTML =
        '<div class="no-events">No results found</div>';
    }
  } catch (error) {
    document.getElementById("search-stats").classList.remove("visible");
    document.getElementById("search-result").innerHTML =
      `<div class="error">${error.message}</div>`;
  }
};

function formatValue(value) {
  if (value === null) return "<em>null</em>";
  if (value === undefined) return "<em>undefined</em>";
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

// Update preview when inputs change
document.addEventListener("DOMContentLoaded", () => {
  [
    "search-entity",
    "search-text",
    "sort-field",
    "sort-order",
    "page-num",
    "page-limit",
    "on-date",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", updateSearchPreview);
      el.addEventListener("change", updateSearchPreview);
    }
  });

  // Initial preview
  updateSearchPreview();
});

window.testSave = async function () {
  const id = document.getElementById("org-id").value;
  const name = document.getElementById("org-name").value;
  const description = document.getElementById("org-desc").value;

  // Build params object, only include fields with actual values
  const params = {};

  if (id && id.trim() !== "") {
    params.id = parseInt(id);
  }

  if (name && name.trim() !== "") {
    params.name = name;
  } else if (!id || id.trim() === "") {
    // Only use default name for new records (no id)
    params.name = `Test Org ${Date.now()}`;
  }

  if (description && description.trim() !== "") {
    params.description = description;
  }

  try {
    const result = await ws.api.save.organisations(params);
    document.getElementById("save-result").innerHTML =
      `<div class="result">${JSON.stringify(result, null, 2)}</div>`;
    // Clear inputs
    document.getElementById("org-id").value = "";
    document.getElementById("org-name").value = "";
    document.getElementById("org-desc").value = "";
  } catch (error) {
    document.getElementById("save-result").innerHTML =
      `<div class="error">${error.message}</div>`;
  }
};

window.testDelete = async function () {
  const id = parseInt(document.getElementById("delete-id").value);
  if (!id) {
    document.getElementById("delete-result").innerHTML =
      '<div class="error">Please enter a valid ID</div>';
    return;
  }

  try {
    const result = await ws.api.delete.organisations({ id });
    document.getElementById("delete-result").innerHTML =
      `<div class="result">${JSON.stringify(result, null, 2)}</div>`;
    document.getElementById("delete-id").value = "";
  } catch (error) {
    document.getElementById("delete-result").innerHTML =
      `<div class="error">${error.message}</div>`;
  }
};

window.clearEvents = function () {
  eventHistory = [];
  renderEvents();
};
