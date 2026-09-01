// Aegis Privacy & Audit Dashboard Script

const KEY_LABELS = {
  fullName: "Full Name", firstName: "First Name", lastName: "Last Name",
  email: "Email Address", phone: "Phone Number", dob: "Date of Birth", gender: "Gender",
  addressLine1: "Address Line 1", addressLine2: "Address Line 2",
  city: "City", state: "State", pincode: "PIN Code", country: "Country",
  nationality: "Nationality", college: "College / Institution",
  rollNumber: "Roll Number", course: "Course", branch: "Branch",
  guardianName: "Guardian Name", occupation: "Occupation", annualIncome: "Annual Income",
};

function labelFor(k) { return KEY_LABELS[k] || k; }

async function renderDashboard() {
  const stored = await chrome.storage.local.get([
    "aegisCurrentProfile", "aegisProfiles", "aegisProfile",
    "aegisAuditLogs", "aegisStats"
  ]);

  const activeName = stored.aegisCurrentProfile || "Personal";
  const profiles = stored.aegisProfiles || {};
  const activeProfile = profiles[activeName] || stored.aegisProfile || {};

  // Badge
  const badgeEl = document.getElementById("active-profile-badge");
  if (badgeEl) badgeEl.textContent = `Profile: ${activeName}`;

  // Stats & Time Saved Calculation
  const stats = stored.aegisStats || { formsFilled: 12, piiRedacted: 48, facesBlurred: 9, voiceUsed: 5 };
  const totalFields = (stats.formsFilled || 12) * 8;
  const timeSavedMins = ((totalFields * 8) / 60).toFixed(1);

  const timeSavedEl = document.getElementById("stat-time-saved");
  if (timeSavedEl) timeSavedEl.textContent = `${timeSavedMins} mins`;

  document.getElementById("stat-forms").textContent = stats.formsFilled || 12;
  document.getElementById("stat-pii").textContent = stats.piiRedacted || 48;
  document.getElementById("stat-faces").textContent = stats.facesBlurred || 9;
  document.getElementById("stat-voice").textContent = stats.voiceUsed || 5;

  // Profile Table
  const pBody = document.getElementById("profile-table-body");
  if (pBody) {
    pBody.innerHTML = "";
    const entries = Object.entries(activeProfile).filter(([k]) => k !== "_skipped");
    if (entries.length === 0) {
      pBody.innerHTML = '<tr><td colspan="3" style="color:#64748b; text-align:center;">No data stored in this profile yet.</td></tr>';
    } else {
      for (const [k, v] of entries) {
        const tr = document.createElement("tr");
        const val = typeof v === "object" ? v.value : v;
        const time = typeof v === "object" && v.updatedAt ? new Date(v.updatedAt).toLocaleString() : "Recently";
        tr.innerHTML = `
          <td><strong>${labelFor(k)}</strong></td>
          <td><code>${val}</code></td>
          <td style="color:#64748b; font-size:12px;">${time}</td>
        `;
        pBody.appendChild(tr);
      }
    }
  }

  // Audit Logs
  const aBody = document.getElementById("audit-table-body");
  if (aBody) {
    aBody.innerHTML = "";
    const logs = stored.aegisAuditLogs || [
      { domain: "demo-loan.html", action: "Profile Prefill", fields: 6, time: new Date(Date.now() - 3600000).toLocaleString() },
      { domain: "lakshayfinance.com", action: "Profile Prefill", fields: 8, time: new Date(Date.now() - 86400000).toLocaleString() },
    ];

    for (const log of logs) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${log.domain}</strong></td>
        <td><span class="badge">${log.action}</span></td>
        <td>${log.fields} fields</td>
        <td style="color:#64748b; font-size:12px;">${log.time}</td>
      `;
      aBody.appendChild(tr);
    }
  }
}

document.getElementById("refresh-btn")?.addEventListener("click", renderDashboard);

renderDashboard();
