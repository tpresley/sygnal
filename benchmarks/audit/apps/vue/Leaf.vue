<script setup>
defineProps(['count', 'onInc'])
</script>
<template>
  <div class="leaf"><span class="val">{{ count }}</span><button class="inc" @click="onInc">+</button></div>
</template>
