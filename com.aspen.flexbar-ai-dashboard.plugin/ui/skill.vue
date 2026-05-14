<template>
  <div class="key-config">
    <v-card class="mx-auto key-card" max-width="720" variant="flat" color="transparent">
      <v-card-item prepend-icon="mdi-star-four-points" title="AI Skill" subtitle="Choose the provider and skill prompt for this key." class="px-0 py-1">
        <template #append>
          <v-chip color="orange" variant="tonal" size="small">{{ sourceLabel }}</v-chip>
        </template>
      </v-card-item>

      <v-card-text class="px-0 py-2">
        <v-row class="ma-n1">
          <v-col cols="12" md="5" class="pa-1">
            <div class="text-subtitle-2 mb-1">Data source</div>
            <v-btn-toggle v-model="dataSource" color="orange" mandatory divided variant="tonal" density="compact" class="w-100">
              <v-btn value="codex" class="flex-grow-1">Codex</v-btn>
              <v-btn value="claude" class="flex-grow-1">Claude Code</v-btn>
            </v-btn-toggle>
          </v-col>

          <v-col cols="12" md="7" class="pa-1">
            <div class="text-subtitle-2 mb-1">Skill</div>
            <div class="d-flex ga-2">
              <v-select
                v-model="skillName"
                :items="skills"
                item-title="name"
                item-value="name"
                label="Select skill"
                color="orange"
                density="compact"
                variant="solo-filled"
                :loading="loading"
                hide-details
              />
              <v-btn
                color="orange"
                icon="mdi-refresh"
                variant="tonal"
                density="compact"
                :loading="loading"
                @click="refreshSkills"
              />
            </div>
          </v-col>
        </v-row>
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
  data() {
    return {
      loading: false,
      skills: [],
    };
  },
  computed: {
    dataSource: {
      get() {
        return this.configValue("dataSource") === "claude" ? "claude" : "codex";
      },
      set(value) {
        this.updateData({ dataSource: value === "claude" ? "claude" : "codex" });
        this.refreshSkills();
      },
    },
    skillName: {
      get() {
        return this.configValue("skillName") || "";
      },
      set(value) {
        this.updateData({ skillName: value || "" });
      },
    },
    sourceLabel() {
      return this.dataSource === "claude" ? "Claude Code" : "Codex";
    },
  },
  methods: {
    configValue(name) {
      const model = this.modelValue && typeof this.modelValue === "object" ? this.modelValue : {};
      if (model.config && typeof model.config === "object" && name in model.config) {
        return model.config[name];
      }
      if (this.isFullKeyModelWithData(model) && name in model.data) {
        return model.data[name];
      }
      return model[name];
    },
    updateData(patch) {
      const model = this.modelValue && typeof this.modelValue === "object" ? this.modelValue : {};
      const title = patch && Object.prototype.hasOwnProperty.call(patch, "skillName")
        ? String(patch.skillName || "").trim()
        : "";

      if (model.config && typeof model.config === "object") {
        this.$emit("update:modelValue", {
          ...model,
          ...(title ? { title } : {}),
          config: {
            ...model.config,
            ...patch,
          },
        });
        return;
      }

      if (this.isFullKeyModelWithData(model)) {
        this.$emit("update:modelValue", {
          ...model,
          ...(title ? { title } : {}),
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
    isFullKeyModelWithData(model) {
      return Boolean(
        model &&
        typeof model.data === "object" &&
        (
          Object.prototype.hasOwnProperty.call(model, "cid") ||
          Object.prototype.hasOwnProperty.call(model, "style") ||
          Object.prototype.hasOwnProperty.call(model, "title")
        )
      );
    },
    async refreshSkills() {
      this.loading = true;
      try {
        this.skills = await this.$fd.sendToBackend({
          type: "skills",
          dataSource: this.dataSource,
        });
        if (!this.skillName && this.skills.length) {
          this.skillName = this.skills[0].name;
        }
      } finally {
        this.loading = false;
      }
    },
  },
  mounted() {
    setKeyConfigPageClass(true);
    this.refreshSkills();
  },
  beforeUnmount() {
    setKeyConfigPageClass(false);
  },
};
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
