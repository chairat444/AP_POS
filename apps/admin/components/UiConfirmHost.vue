<script setup lang="ts">
const { state, cancel, confirm } = useConfirmDialog();

function onKey(e: KeyboardEvent) {
  if (!state.open || state.busy) return;
  if (e.key === "Escape") {
    e.preventDefault();
    cancel();
  } else if (e.key === "Enter") {
    e.preventDefault();
    confirm();
  }
}

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.open"
      class="ui-confirm"
      role="presentation"
      @click.self="cancel"
    >
      <div
        class="ui-confirm__panel"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="'ui-confirm-title'"
        :aria-describedby="'ui-confirm-msg'"
      >
        <div class="ui-confirm__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
            />
          </svg>
        </div>
        <h2 id="ui-confirm-title" class="ui-confirm__title">{{ state.title }}</h2>
        <p id="ui-confirm-msg" class="ui-confirm__message">{{ state.message }}</p>
        <p v-if="state.detail" class="ui-confirm__detail">{{ state.detail }}</p>
        <div class="ui-confirm__actions">
          <button
            type="button"
            class="ui-btn ui-btn--ghost"
            :disabled="state.busy"
            @click="cancel"
          >
            {{ state.cancelLabel }}
          </button>
          <button
            type="button"
            class="ui-btn"
            :class="state.tone === 'danger' ? 'ui-btn--danger' : 'ui-btn--primary'"
            :disabled="state.busy"
            @click="confirm"
          >
            {{ state.confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
