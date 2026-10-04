<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">水文监测站网管理系统</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向水文监测站点运行、水位流量雨量数据采集、遥测设备维护与数据整编发布的水文站网管理平台。</span>
        <span class="head-user">
          <template v-if="store.canOperate">
            当前值班：{{ store.operator }}
            <label class="unit-switch">
              归属单位
              <select :value="store.unit ?? ''" @change="onSwitchUnit">
                <option v-for="unit in MANAGE_UNITS" :key="unit" :value="unit">{{ unit }}</option>
              </select>
            </label>
            · {{ store.shiftLabel }}
            <button class="btn tiny" type="button" @click="store.logout()">退出登录</button>
          </template>
          <template v-else>
            当前未登录（只读）：写动作已被数据层拦截
            <button class="btn tiny primary" type="button" @click="relogin">重新登录</button>
          </template>
        </span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { MANAGE_UNITS, useSessionStore } from '@/stores/session'

const store = useSessionStore()

function onSwitchUnit(event: Event) {
  const unit = (event.target as HTMLSelectElement).value as (typeof MANAGE_UNITS)[number]
  store.switchUnit(unit)
}

// 纯前端演示：退出后可用原身份重新登录，归属单位可自选，便于演示跨单位拦截。
function relogin() {
  store.login('值班管理员', MANAGE_UNITS[0])
}

const navItems = [{ label: "运营概览", path: "/" }, { label: "监测站点", path: "/station" }, { label: "水位监测", path: "/waterlevel" }, { label: "流量监测", path: "/discharge" }, { label: "雨量观测", path: "/rainfall" }, { label: "水质检测", path: "/waterquality" }, { label: "断面测量", path: "/crosssection" }, { label: "遥测设备", path: "/telemetry" }, { label: "数据整编", path: "/compilation" }, { label: "预警阈值", path: "/warning" }, { label: "地下水观测", path: "/groundwater" }, { label: "蒸发观测", path: "/evaporation" }, { label: "测流缆道", path: "/cableway" }, { label: "泥沙监测", path: "/sediment" }, { label: "通讯系统", path: "/communication" }, { label: "站房维护", path: "/stationhouse" }, { label: "仪器检定", path: "/calibration" }, { label: "巡检记录", path: "/inspection" }, { label: "测报方案", path: "/plan" }]
</script>

<style scoped>
.head-user { display: inline-flex; align-items: center; gap: 8px; }
.unit-switch { display: inline-flex; align-items: center; gap: 4px; }
.unit-switch select { padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border); }
.btn.tiny { padding: 2px 8px; font-size: 12px; }
</style>
