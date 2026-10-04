<script setup>
import Leaf from './Leaf.vue'
defineOptions({ name: 'Level' })
defineProps(['depth', 'count', 'onInc'])
</script>
<template>
  <div class="lvl">
    <Level v-if="depth > 0" :depth="depth - 1" :count="count" :onInc="onInc" />
    <Leaf v-else :count="count" :onInc="onInc" />
  </div>
</template>
