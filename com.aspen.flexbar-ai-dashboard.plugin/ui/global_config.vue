<template>
  <v-container fluid class="config-page">
    <v-card variant="flat" color="transparent" class="config-card">
      <v-card-item
        prepend-icon="mdi-view-dashboard-outline"
        title="Flexbar AI Dashboard"
        subtitle="Local Codex and Claude Code status used by the Flexbar keys."
        class="px-0 pt-0 pb-2"
      >
        <template #append>
          <v-chip :color="overallReady ? 'success' : 'orange'" variant="tonal" size="small">
            <v-icon start size="16">{{ overallIcon }}</v-icon>
            {{ overallText }}
          </v-chip>
        </template>
      </v-card-item>

      <v-card-text class="px-0 py-2">
        <v-alert v-if="error" type="error" density="compact" variant="tonal" class="mb-3">
          {{ error }}
        </v-alert>
        <v-alert
          v-for="warning in warnings"
          :key="warning"
          type="warning"
          density="compact"
          variant="tonal"
          class="mb-2"
        >
          {{ warning }}
        </v-alert>

        <v-list bg-color="transparent" density="compact" lines="two" class="status-list">
          <v-list-item
            v-for="item in statusItems"
            :key="item.label"
            rounded="lg"
            class="px-3"
          >
            <template #prepend>
              <v-icon :color="item.ok ? 'success' : 'orange'" size="20">
                {{ item.ok ? "mdi-check-circle-outline" : "mdi-alert-circle-outline" }}
              </v-icon>
            </template>
            <v-list-item-title>{{ item.label }}</v-list-item-title>
            <v-list-item-subtitle class="status-value" :title="item.value">
              {{ item.value }}
            </v-list-item-subtitle>
            <template #append>
              <v-chip size="x-small" :color="item.ok ? 'success' : 'orange'" variant="tonal">
                {{ item.badge }}
              </v-chip>
            </template>
          </v-list-item>
        </v-list>

        <div class="actions">
          <v-btn color="orange" variant="flat" :loading="busy" @click="installAll">
            <v-icon start>mdi-auto-fix</v-icon>
            One-click install
          </v-btn>
          <v-btn color="orange" variant="tonal" :loading="busy" @click="refresh">
            <v-icon start>mdi-refresh</v-icon>
            Refresh
          </v-btn>
          <v-btn color="error" variant="text" :loading="busy" @click="uninstallAll">
            <v-icon start>mdi-delete-outline</v-icon>
            Uninstall config
          </v-btn>
        </div>
      </v-card-text>

      <v-expansion-panels variant="accordion" class="mt-2">
        <v-expansion-panel>
          <v-expansion-panel-title>
            <div class="d-inline-flex align-center ga-2">
              <v-icon size="18">mdi-tune-variant</v-icon>
              Advanced
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-checkbox
              v-model="overwriteStatusLine"
              label="Replace existing Claude statusLine during one-click install"
              hide-details
              density="compact"
            />
          </v-expansion-panel-text>
        </v-expansion-panel>

        <v-expansion-panel>
          <v-expansion-panel-title>
            <div class="d-inline-flex align-center ga-2">
              <v-icon size="18">mdi-text-box-search-outline</v-icon>
              Diagnostics
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-textarea
              :model-value="snapshotText"
              readonly
              auto-grow
              no-resize
              rows="4"
              density="compact"
              variant="solo-filled"
              color="orange"
              hide-details
            />
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card>
  </v-container>
</template>

<script>
function setConfigPageClass(enabled) {
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.toggle("ai-dashboard-config-page", enabled);
  }
}

export default {
  data() {
    return {
      busy: false,
      error: "",
      overwriteStatusLine: false,
      setupResult: null,
      status: {},
      snapshot: null,
    };
  },
  computed: {
    warnings() {
      return this.setupResult && this.setupResult.warnings ? this.setupResult.warnings : [];
    },
    statusItems() {
      const codex = this.status.codex || {};
      const claude = this.status.claude || {};
      return [
        {
          label: "Codex home",
          ok: Boolean(codex.codexHomeExists),
          value: codex.codexHome || "-",
        },
        {
          label: "Codex auth",
          ok: Boolean(codex.authJsonExists),
          value: codex.authJsonExists ? "auth.json found" : "auth.json missing",
        },
        {
          label: "Codex sessions",
          ok: Boolean(codex.sessionsDirExists),
          value: codex.sessionsDir || "session directory missing",
        },
        {
          label: "Claude hooks",
          ok: Boolean(claude.hooksInstalled),
          value: claude.hooksInstalled ? "Flexbar hook handlers installed" : "hook handlers missing",
        },
        {
          label: "Claude statusLine",
          ok: Boolean(claude.statusLineInstalled),
          value: this.statusLineText,
        },
        {
          label: "Claude bridge file",
          ok: Boolean(claude.bridgePath),
          value: claude.bridgePath || "-",
        },
      ].map((item) => ({
        ...item,
        badge: item.ok ? "OK" : "Missing",
      }));
    },
    overallReady() {
      return this.statusItems.length > 0 && this.statusItems.every((item) => item.ok);
    },
    overallText() {
      return this.overallReady ? "Ready" : "Needs setup";
    },
    overallIcon() {
      return this.overallReady ? "mdi-check-circle" : "mdi-alert-circle-outline";
    },
    statusLineText() {
      const claude = this.status.claude || {};
      if (claude.statusLineInstalled) return "installed";
      if (claude.statusLineConflict) return "existing user statusLine found";
      return "not installed";
    },
    snapshotText() {
      return this.snapshot ? JSON.stringify(this.snapshot, null, 2) : "No snapshot yet";
    },
  },
  methods: {
    async refresh() {
      this.busy = true;
      this.error = "";
      try {
        this.status = await this.$fd.sendToBackend({ type: "setupStatus" });
        this.snapshot = await this.$fd.sendToBackend({ type: "snapshot" });
      } catch (error) {
        this.error = error && error.message ? error.message : String(error);
      } finally {
        this.busy = false;
      }
    },
    async installAll() {
      this.busy = true;
      this.error = "";
      try {
        this.setupResult = await this.$fd.sendToBackend({
          type: "installAll",
          overwriteStatusLine: this.overwriteStatusLine,
        });
        await this.refresh();
      } catch (error) {
        this.error = error && error.message ? error.message : String(error);
      } finally {
        this.busy = false;
      }
    },
    async uninstallAll() {
      this.busy = true;
      this.error = "";
      try {
        this.setupResult = await this.$fd.sendToBackend({ type: "uninstallAll" });
        await this.refresh();
      } catch (error) {
        this.error = error && error.message ? error.message : String(error);
      } finally {
        this.busy = false;
      }
    },
  },
  mounted() {
    setConfigPageClass(true);
    this.refresh();
  },
  beforeUnmount() {
    setConfigPageClass(false);
  },
};
</script>

<style scoped>
.config-page {
  max-width: 980px;
  padding: 16px;
  overflow: visible;
}

.config-card {
  overflow: visible;
}

.status-value {
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}

.config-page :deep(.v-btn) {
  letter-spacing: 0;
  text-transform: none;
}

.config-page :deep(.v-list-item) {
  margin-bottom: 4px;
}

.config-page :deep(.v-expansion-panel) {
  box-shadow: none !important;
}

.config-page :deep(.v-expansion-panel::after) {
  border: 0 !important;
}

.config-page :deep(textarea) {
  overflow-y: hidden !important;
}

:global(body.ai-dashboard-config-page) {
  margin: 0 !important;
}

:global(body.ai-dashboard-config-page #app),
:global(body.ai-dashboard-config-page .v-application),
:global(body.ai-dashboard-config-page .v-application__wrap),
:global(body.ai-dashboard-config-page .v-main),
:global(body.ai-dashboard-config-page .v-main__wrap) {
  min-height: 0 !important;
}

@media (max-width: 760px) {
  .config-page {
    padding: 12px;
  }
}
</style>
