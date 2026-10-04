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
        <div v-if="store.canOperate" class="head-session">
          <span class="head-user">当前值班：{{ store.operator }} · {{ store.unit }} · {{ store.shiftLabel }}</span>
          <button class="btn ghost" type="button" @click="signOut">退出</button>
        </div>
        <form v-else class="head-session" @submit.prevent="signIn">
          <span class="head-user">已退出：待办与历史结论保持原样，重新登录后按归属单位操作</span>
          <input v-model="loginName" class="head-input" placeholder="值班人" />
          <select v-model="loginUnit" class="head-input">
            <option v-for="unit in units" :key="unit" :value="unit">{{ unit }}</option>
          </select>
          <button class="btn" type="submit">登录</button>
        </form>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { knownUnits } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const navItems = [{ label: "运营概览", path: "/" }, { label: "监测站点", path: "/station" }, { label: "水位监测", path: "/waterlevel" }, { label: "流量监测", path: "/discharge" }, { label: "雨量观测", path: "/rainfall" }, { label: "水质检测", path: "/waterquality" }, { label: "断面测量", path: "/crosssection" }, { label: "遥测设备", path: "/telemetry" }, { label: "数据整编", path: "/compilation" }, { label: "预警阈值", path: "/warning" }, { label: "地下水观测", path: "/groundwater" }, { label: "蒸发观测", path: "/evaporation" }, { label: "测流缆道", path: "/cableway" }, { label: "泥沙监测", path: "/sediment" }, { label: "通讯系统", path: "/communication" }, { label: "站房维护", path: "/stationhouse" }, { label: "仪器检定", path: "/calibration" }, { label: "巡检记录", path: "/inspection" }, { label: "测报方案", path: "/plan" }]

const units = knownUnits()
const loginName = ref('值班管理员')
const loginUnit = ref(units[0] ?? '')

function signOut() {
  store.signOut()
}

function signIn() {
  const operator = loginName.value.trim()
  if (!operator || !loginUnit.value) {
    return
  }
  store.signIn(operator, loginUnit.value)
}
</script>
