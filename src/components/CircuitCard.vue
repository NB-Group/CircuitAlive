<script setup>
/* CircuitCard — 作品库里的一张电路卡片
 *
 * 缩略图是真渲染(CircuitThumbnail 用编辑器同一套 renderer/symbols)。
 * 悬停时抬起并浮出操作按钮;星标独立于卡片点击,不触发打开。
 *
 * 可访问性:卡片本身不是按钮。一个铺满整张卡片的透明按钮负责「打开」,
 * 键盘焦点和读屏都落在它上面;星标与操作按钮浮在它之上,不会形成
 * 按钮套按钮的非法结构。
 *
 * 事件:open · share · rename · remove · favorite
 */
import { computed } from 'vue'
import CircuitThumbnail from './CircuitThumbnail.vue'
import { relativeTime } from '../composables/formatTime.js'

const props = defineProps({
  item: { type: Object, required: true },
  favorite: { type: Boolean, default: false },
  viewedAt: { type: Number, default: 0 },
  imported: { type: Boolean, default: false },
  index: { type: Number, default: 0 },
  view: { type: String, default: 'grid' }
})

const emit = defineEmits(['open', 'share', 'rename', 'remove', 'favorite'])

const stamp = computed(() => {
  const t = props.viewedAt || props.item.updatedAt
  return relativeTime(t) + (props.viewedAt ? '已查看' : '已保存')
})

const meta = computed(() => {
  const n = props.item.data && props.item.data.edges ? props.item.data.edges.length : 0
  return n + ' 个元件'
})

const openLabel = computed(() => '打开电路 ' + props.item.name)

function onOpen() { emit('open', props.item) }

function act(name, ev) {
  ev.stopPropagation()
  emit(name, props.item)
}
</script>

<template>
  <article
    v-if="view === 'grid'"
    class="ff-lib-card"
    :style="{ '--i': index }"
  >
    <button type="button" class="ff-lib-cover" :aria-label="openLabel" @click="onOpen"></button>

    <div class="ff-lib-thumb">
      <CircuitThumbnail :data="item.data" />

      <button
        type="button"
        class="ff-lib-star"
        :class="{ on: favorite }"
        :aria-pressed="favorite"
        :aria-label="favorite ? '取消收藏' : '收藏'"
        :title="favorite ? '取消收藏' : '收藏'"
        @click="act('favorite', $event)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
        </svg>
      </button>

      <span v-if="imported" class="ff-lib-flag">导入</span>

      <div class="ff-lib-actions">
        <button type="button" class="ff-lib-act primary" @click.stop="onOpen">打开</button>
        <button type="button" class="ff-lib-act" @click="act('share', $event)">分享</button>
        <button type="button" class="ff-lib-act" @click="act('rename', $event)">重命名</button>
        <button type="button" class="ff-lib-act danger" @click="act('remove', $event)">删除</button>
      </div>
    </div>

    <div class="ff-lib-info">
      <h3 class="ff-lib-name" :title="item.name">{{ item.name }}</h3>
      <p class="ff-lib-meta">
        <span class="ff-num">{{ meta }}</span>
        <span class="sep" aria-hidden="true"></span>
        <span>{{ stamp }}</span>
      </p>
    </div>
  </article>

  <div
    v-else
    class="ff-lib-row"
    :style="{ '--i': index }"
  >
    <button type="button" class="ff-lib-cover" :aria-label="openLabel" @click="onOpen"></button>

    <div class="ff-lib-row-thumb">
      <CircuitThumbnail :data="item.data" />
    </div>

    <div class="ff-lib-row-main">
      <h3 class="ff-lib-name" :title="item.name">{{ item.name }}</h3>
      <p class="ff-lib-meta">
        <span class="ff-num">{{ meta }}</span>
        <span class="sep" aria-hidden="true"></span>
        <span>{{ stamp }}</span>
        <span v-if="imported" class="ff-lib-flag inline">导入</span>
      </p>
    </div>

    <button
      type="button"
      class="ff-lib-star row"
      :class="{ on: favorite }"
      :aria-pressed="favorite"
      :aria-label="favorite ? '取消收藏' : '收藏'"
      :title="favorite ? '取消收藏' : '收藏'"
      @click="act('favorite', $event)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
      </svg>
    </button>

    <div class="ff-lib-row-actions">
      <button type="button" class="ff-lib-act" @click.stop="onOpen">打开</button>
      <button type="button" class="ff-lib-act" @click="act('share', $event)">分享</button>
      <button type="button" class="ff-lib-act" @click="act('rename', $event)">重命名</button>
      <button type="button" class="ff-lib-act danger" @click="act('remove', $event)">删除</button>
    </div>
  </div>
</template>
