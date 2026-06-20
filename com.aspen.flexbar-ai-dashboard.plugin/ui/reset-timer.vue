<template>
  <div class="key-config">
    <v-card class="mx-auto key-card" max-width="720" variant="flat" color="transparent">
      <v-card-item prepend-icon="mdi-timer-sand" title="Reset Timer" subtitle="Choose the provider for the limit reset countdown." class="px-0 py-1">
        <template #append>
          <v-chip color="orange" variant="tonal" size="small">{{ sourceLabel }}</v-chip>
        </template>
      </v-card-item>

      <v-card-text class="px-0 py-2">
        <div class="text-subtitle-2 mb-1">Data source</div>
        <v-btn-toggle v-model="dataSource" color="orange" mandatory divided variant="tonal" density="compact" class="w-100">
          <v-btn value="codex" class="flex-grow-1">Codex</v-btn>
          <v-btn value="claude" class="flex-grow-1">Claude Code</v-btn>
        </v-btn-toggle>
      </v-card-text>
    </v-card>
  </div>
</template>

<script>
function setKeyConfigPageClass(enabled) {
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.toggle("ai-dashboard-key-config", enabled);
  }
}

export default {
  props: {
    modelValue: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ["update:modelValue"],
  computed: {
    dataSource: {
      get() {
        return this.configValue("dataSource") === "claude" ? "claude" : "codex";
      },
      set(value) {
        this.updateData({ dataSource: value === "claude" ? "claude" : "codex" });
      },
    },
    sourceLabel() {
      return this.dataSource === "claude" ? "Claude Code" : "Codex";
    },
  },
  methods: {
    configValue(name) {
      const model = isObject(this.modelValue) ? this.modelValue : {};
      const data = isObject(model.data) ? model.data : {};
      const nestedConfig = isObject(data.config) ? data.config : {};
      const config = isObject(model.config) ? model.config : {};
      return config[name] ?? nestedConfig[name] ?? model[name] ?? data[name];
    },
    updateData(patch) {
      const model = isObject(this.modelValue) ? this.modelValue : {};
      const nestedModel = withoutTopLevelPatch(model, patch);
      if (isObject(model.config)) {
        this.$emit("update:modelValue", {
          ...nestedModel,
          config: {
            ...model.config,
            ...patch,
          },
        });
        return;
      }

      if (isObject(model.data) && isObject(model.data.config)) {
        this.$emit("update:modelValue", {
          ...nestedModel,
          data: {
            ...model.data,
            config: {
              ...model.data.config,
              ...patch,
            },
          },
        });
        return;
      }

      if (isFullKeyModelWithData(model)) {
        this.$emit("update:modelValue", {
          ...nestedModel,
          data: {
            ...model.data,
            ...patch,
          },
        });
        return;
      }

      this.$emit("update:modelValue", {
        ...model,
        ...patch,
      });
    },
  },
  mounted() {
    setKeyConfigPageClass(true);
  },
  beforeUnmount() {
    setKeyConfigPageClass(false);
  },
};

function isFullKeyModelWithData(model) {
  return isObject(model.data) && (
    Object.prototype.hasOwnProperty.call(model, "cid") ||
    Object.prototype.hasOwnProperty.call(model, "style") ||
    Object.prototype.hasOwnProperty.call(model, "title")
  );
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function withoutTopLevelPatch(model, patch) {
  const next = { ...model };
  for (const name of Object.keys(patch || {})) {
    delete next[name];
  }
  return next;
}
</script>

<style scoped>
.key-config {
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.key-card {
  overflow: visible;
}

.key-config :deep(.v-btn) {
  letter-spacing: 0;
  text-transform: none;
}

:global(body.ai-dashboard-key-config) {
  margin: 0 !important;
  overflow-y: hidden !important;
}

:global(body.ai-dashboard-key-config #app),
:global(body.ai-dashboard-key-config .v-application),
:global(body.ai-dashboard-key-config .v-application__wrap),
:global(body.ai-dashboard-key-config .v-main),
:global(body.ai-dashboard-key-config .v-main__wrap) {
  min-height: 0 !important;
  overflow-y: hidden !important;
}
</style>
