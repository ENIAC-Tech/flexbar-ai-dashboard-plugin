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
              <v-icon size="18">mdi-folder-cog-outline</v-icon>
              Path overrides
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <div class="text-caption text-medium-emphasis mb-3">
              Leave blank to use auto-detected paths from environment variables. Placeholders show the current resolved default.
            </div>

            <v-text-field
              v-for="field in pathFields"
              :key="field.key"
              :model-value="pathOverrides[field.key]"
              :label="field.label"
              :placeholder="field.resolved"
              :hint="fieldHint(field)"
              :error="Boolean(pathFieldErrors[field.key])"
              :error-messages="pathFieldErrors[field.key]"
              persistent-hint
              density="compact"
              variant="outlined"
              color="orange"
              hide-details="auto"
              class="mb-2 path-override-field"
              @update:model-value="updatePathOverride(field.key, $event)"
            />

            <div class="d-flex flex-wrap align-center ga-2 mt-1">
              <v-btn
                color="orange"
                variant="flat"
                :loading="savingPaths"
                :disabled="!pathOverridesDirty"
                @click="applyPathOverrides"
              >
                <v-icon start>mdi-content-save-outline</v-icon>
                Apply path overrides
              </v-btn>
              <span v-if="pathSaveMessage" class="text-caption text-medium-emphasis">
                {{ pathSaveMessage }}
              </span>
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>

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

const EMPTY_PLUGIN_SETTINGS = {
  overwriteStatusLine: false,
  pathOverrides: {},
};

export default {
  props: {
    modelValue: {
      type: Object,
      default: () => ({ config: {} }),
    },
  },
  emits: ["update:modelValue"],
  data() {
    return {
      busy: false,
      savingPaths: false,
      error: "",
      setupResult: null,
      status: {},
      snapshot: null,
      pathFields: [],
      pluginSettings: { ...EMPTY_PLUGIN_SETTINGS, pathOverrides: {} },
      savedPluginSettings: { ...EMPTY_PLUGIN_SETTINGS, pathOverrides: {} },
      pathValidationErrors: {},
      pathSaveMessage: "",
      settingsLoaded: false,
    };
  },
  computed: {
    pathFieldErrors() {
      const errors = {};
      for (const field of this.pathFields) {
        const message = this.pathValidationErrors[field.key];
        if (message) errors[field.key] = [message];
      }
      return errors;
    },
    pathOverrides() {
      const overrides = isObject(this.pluginSettings.pathOverrides)
        ? this.pluginSettings.pathOverrides
        : {};
      const normalized = {};
      for (const field of this.pathFields) {
        normalized[field.key] = typeof overrides[field.key] === "string" ? overrides[field.key] : "";
      }
      return normalized;
    },
    pathOverridesDirty() {
      return JSON.stringify(this.pluginSettings) !== JSON.stringify(this.savedPluginSettings);
    },
    overwriteStatusLine: {
      get() {
        return Boolean(this.pluginSettings.overwriteStatusLine);
      },
      set(value) {
        this.pluginSettings = {
          ...this.pluginSettings,
          overwriteStatusLine: Boolean(value),
        };
        this.persistPluginSettings();
      },
    },
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
    fieldHint(field) {
      const error = this.pathValidationErrors[field.key];
      if (error) return error;
      return field.description;
    },
    applyPluginSettings(config) {
      const root = isObject(config) ? config : {};
      const overrides = isObject(root.pathOverrides) ? root.pathOverrides : {};
      const nextSettings = {
        overwriteStatusLine: Boolean(root.overwriteStatusLine),
        pathOverrides: { ...overrides },
      };
      this.pluginSettings = { ...nextSettings, pathOverrides: { ...nextSettings.pathOverrides } };
      this.savedPluginSettings = {
        overwriteStatusLine: nextSettings.overwriteStatusLine,
        pathOverrides: { ...nextSettings.pathOverrides },
      };
      this.settingsLoaded = true;
      this.pathValidationErrors = {};
      this.pathSaveMessage = "";
    },
    hasStoredSettings(config) {
      if (!isObject(config)) return false;
      if (Object.keys(config.pathOverrides || {}).some((key) => config.pathOverrides[key])) {
        return true;
      }
      return Boolean(config.overwriteStatusLine);
    },
    async loadInitialSettings() {
      const hosted = isObject(this.modelValue && this.modelValue.config)
        ? this.modelValue.config
        : null;
      if (this.hasStoredSettings(hosted)) {
        this.applyPluginSettings(hosted);
        return;
      }

      const remote = await this.$fd.sendToBackend({ type: "getPluginConfig" });
      this.applyPluginSettings(remote);
    },
    buildConfigPayload(settings = this.pluginSettings) {
      return {
        overwriteStatusLine: Boolean(settings.overwriteStatusLine),
        pathOverrides: isObject(settings.pathOverrides)
          ? { ...settings.pathOverrides }
          : {},
      };
    },
    async commitPluginConfig(config) {
      if (typeof this.$fd.setConfig === "function") {
        await this.$fd.setConfig(config);
      }

      this.$emit("update:modelValue", {
        ...(isObject(this.modelValue) ? this.modelValue : {}),
        config,
      });
    },
    async persistPluginSettings() {
      const candidate = this.buildConfigPayload();

      try {
        const result = await this.$fd.sendToBackend({
          type: "savePluginConfig",
          config: candidate,
        });
        if (result && result.ok === false) {
          if (Array.isArray(result.errors) && result.errors.length > 0) {
            this.pathValidationErrors = errorsByField(result.errors);
            this.error = "Fix path override errors before saving.";
            return false;
          }
          throw new Error(result.error || "Failed to save plugin settings");
        }

        await this.commitPluginConfig((result && result.config) || candidate);
        this.applyPluginSettings((result && result.config) || candidate);
        this.pathValidationErrors = {};
        this.error = "";
        return true;
      } catch (error) {
        this.error = error && error.message ? error.message : String(error);
        return false;
      }
    },
    async applyPathOverrides() {
      this.savingPaths = true;
      this.pathSaveMessage = "";
      try {
        const saved = await this.persistPluginSettings();
        if (!saved) return;
        this.pathSaveMessage = "Path overrides saved.";
        await this.refresh();
      } finally {
        this.savingPaths = false;
      }
    },
    updatePathOverride(key, value) {
      if (this.pathValidationErrors[key]) {
        const nextErrors = { ...this.pathValidationErrors };
        delete nextErrors[key];
        this.pathValidationErrors = nextErrors;
      }
      const overrides = { ...this.pathOverrides };
      overrides[key] = typeof value === "string" ? value : "";
      this.pluginSettings = {
        ...this.pluginSettings,
        pathOverrides: overrides,
      };
      this.pathSaveMessage = "";
    },
    async refresh() {
      this.busy = true;
      this.error = "";
      try {
        const [status, snapshot, pathFields] = await Promise.all([
          this.$fd.sendToBackend({ type: "setupStatus" }),
          this.$fd.sendToBackend({ type: "snapshot" }),
          this.$fd.sendToBackend({ type: "pathDefaults" }),
        ]);
        this.status = status;
        this.snapshot = snapshot;
        this.pathFields = Array.isArray(pathFields) ? pathFields : [];
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
  async mounted() {
    setConfigPageClass(true);
    this.busy = true;
    this.error = "";
    try {
      await this.loadInitialSettings();
      await this.refresh();
    } catch (error) {
      this.error = error && error.message ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  },
  beforeUnmount() {
    setConfigPageClass(false);
  },
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorsByField(errors) {
  const byField = {};
  for (const item of errors) {
    if (!item || !item.key || !item.message || byField[item.key]) continue;
    byField[item.key] = item.message;
  }
  return byField;
}
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

.path-override-field :deep(input) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
