<script setup>
import { ref } from 'vue'
const n = ref(0)
</script>
<template>
  <div class="counter"><span class="val">{{ n }}</span><button class="inc" @click="n++">+</button></div>
</template>
