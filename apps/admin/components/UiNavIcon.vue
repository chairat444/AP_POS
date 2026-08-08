<script setup lang="ts">
defineProps<{ name: string }>();
</script>

<template>
  <svg
    class="ui-nav-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.9"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- home -->
    <template v-if="name === 'home'">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </template>
    <!-- box / products -->
    <template v-else-if="name === 'box'">
      <path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7Z" />
      <path d="M3 8.5 12 14l9-5.5" />
      <path d="M12 14v7" />
    </template>
    <!-- zap / quick -->
    <template v-else-if="name === 'zap'">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </template>
    <!-- ruler / units -->
    <template v-else-if="name === 'ruler'">
      <path d="M3 16.5 16.5 3l4.5 4.5L7.5 21 3 16.5Z" />
      <path d="m7 13 1.5 1.5M10 10l1.5 1.5M13 7l1.5 1.5" />
    </template>
    <!-- tag / promo -->
    <template v-else-if="name === 'tag'">
      <path d="M20 12.5 12.5 20a2 2 0 0 1-2.8 0L3 13.3V4h9.3L20 11.7a2 2 0 0 1 0 .8Z" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </template>
    <!-- receipt / sales -->
    <template v-else-if="name === 'receipt'">
      <path d="M6 3h12v18l-2-1.2L14 21l-2-1.2L10 21l-2-1.2L6 21V3Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </template>
    <!-- chart / reports -->
    <template v-else-if="name === 'chart'">
      <path d="M4 19h16" />
      <path d="M7 16V10M12 16V6M17 16v-4" />
    </template>
    <!-- users -->
    <template v-else-if="name === 'users'">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3.2" />
      <path d="M22 21v-2a3.5 3.5 0 0 0-2.5-3.3" />
      <path d="M16.5 4.2a3.2 3.2 0 0 1 0 5.8" />
    </template>
    <!-- store / branch -->
    <template v-else-if="name === 'store'">
      <path d="M3 10h18l-1.5-5H4.5L3 10Z" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </template>
    <!-- user / member -->
    <template v-else-if="name === 'user'">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </template>
    <!-- badge / staff -->
    <template v-else-if="name === 'badge'">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M8 14.5 6 21l6-2.5L18 21l-2-6.5" />
      <path d="M8.5 11.5a6 6 0 0 0 7 0" />
    </template>
    <!-- terminal / POS machine -->
    <template v-else-if="name === 'terminal'">
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </template>
    <!-- shift / cash drawer -->
    <template v-else-if="name === 'shift'">
      <rect x="3" y="7" width="18" height="12" rx="1.5" />
      <path d="M3 11h18M8 15h3" />
      <path d="M12 3v4" />
    </template>
    <!-- settings -->
    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </template>
    <!-- coin / points -->
    <template v-else>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v10M9.5 9.5c.6-1 1.5-1.5 2.5-1.5 1.7 0 3 1 3 2.5S13.7 13 12 13s-3 1-3 2.5 1.3 2.5 3 2.5c1 0 1.9-.5 2.5-1.5" />
    </template>
  </svg>
</template>
