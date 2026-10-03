<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NTag, NEmpty, NAlert, NGrid, NGridItem } from 'naive-ui'
import { useState, nowStr, releaseBooking, endUsage, releaseIdleHalf } from '../store'
import {
  SURFACE_META, HOOP_META, bookingsOfHalf, checkedInCount, courtRisk,
  fmt, halfSealed, isActive, timeState, underfillView, boundaryConfirmed, money
} from '../lib/engine'
import { lightLive } from '../store'
import type { Booking, Court } from '../types'
import RiskTag from '../components/RiskTag.vue'
import RuleLink from '../components/RuleLink.vue'
import { openIncidents } from '../lib/ui'

const state = useState()

function currentOf(c: Court, h: string): Booking | undefined {
  return bookingsOfHalf(c, h, state.bookings).find(b => isActive(b, nowStr.value))
}
function nextOf(c: Court, h: string): Booking | undefined {
  return bookingsOfHalf(c, h, state.bookings)
    .filter(b => b.status === 'booked')
    .sort((a, b) => a.start.localeCompare(b.start))[0]
}

const stats = computed(() => {
  const active = state.bookings.filter(b => isActive(b, nowStr.value))
  return {
    courts: state.courts.length,
    activeBookings: active.length,
    present: active.reduce((s, b) => s + checkedInCount(b), 0),
    openIncidents: state.incidents.filter(i => i.status === 'open').length,
    mediating: state.incidents.filter(i => i.status === 'mediating').length
  }
})

function remainBig(b: Booking) {
  const t = timeState(b, nowStr.value)
  if (t.overtimeMinutes >= 15) return { text: `超时${t.overtimeMinutes}分·可强制清场`, cls: 'r-error' }
  if (t.overtimeMinutes > 0) return { text: `超时 ${t.overtimeMinutes} 分`, cls: 'r-error' }
  if (t.inGrace) return { text: '清场缓冲 5 分内', cls: 'r-warn' }
  const m = t.remaining
  if (m <= 0) return { text: '时段结束', cls: 'r-warn' }
  return { text: `还能打 ${fmt(m)}`, cls: m <= 15 ? 'r-warn' : 'r-ok' }
}

function release(b: Booking) { releaseBooking(b.id) }
function forceEnd(b: Booking) { endUsage(b.id, true) }
function releaseHalf(b: Booking) { releaseIdleHalf(b.id) }

// 全场人数不足
function uf(b: Booking) { return underfillView(b, state.mergeRequests, nowStr.value) }
/** 释放后与该半场共用场地的对组 */
function pairBooking(b: Booking): Booking | undefined {
  if (b.underfill?.stage !== 'released') return undefined
  return state.bookings.find(x => x.id === (b.splitFromId ?? b.underfill?.walkerBookingId))
}
function liveFee(b: Booking) { return lightLive(b)?.fee ?? 0 }
</script>

<template>
  <div class="page">
    <NAlert type="info" :show-icon="false" style="margin-bottom:10px;border-radius:10px">
      <div style="font-size:12px;line-height:1.7">
        现场看板（<b>当前时间 {{ nowStr }}</b>）：队长、散客、管理员、社区工作人员共用。一眼看清<b>每个篮筐该谁用、还能打多久、争议按什么规则处理</b>。
      </div>
    </NAlert>

    <NGrid :cols="3" :x-gap="6" style="margin-bottom:10px">
      <NGridItem><div class="kpi"><div class="kpi-n">{{ stats.activeBookings }}</div><div class="kpi-l">进行中场次</div></div></NGridItem>
      <NGridItem><div class="kpi"><div class="kpi-n">{{ stats.present }}</div><div class="kpi-l">现场签到人数</div></div></NGridItem>
      <NGridItem><div class="kpi"><div class="kpi-n" :style="{ color: stats.openIncidents + stats.mediating > 0 ? '#d03050' : undefined }">{{ stats.openIncidents + stats.mediating }}</div><div class="kpi-l">待处理事件</div></div></NGridItem>
    </NGrid>

    <div v-for="c in state.courts" :key="c.id" class="court-board">
      <div class="cb-head">
        <div>
          <b>{{ c.name }}</b>
          <NTag :type="SURFACE_META[c.surface].type" size="tiny" round style="margin-left:6px">{{ SURFACE_META[c.surface].label }}</NTag>
          <NTag v-if="c.sealed" type="error" size="tiny" round>已封场</NTag>
        </div>
        <RiskTag :level="courtRisk(c, state.bookings, state.incidents, nowStr).level"
          :reasons="courtRisk(c, state.bookings, state.incidents, nowStr).reasons" />
      </div>

      <div v-if="c.sealed" class="seal-line">🚧 {{ c.sealReason }}</div>

      <div v-for="h in Object.keys(c.hoops)" :key="h" class="half-row"
        :class="{ unusable: halfSealed(c, h) || c.hoops[h] !== 'normal' }">
        <div class="hr-half">
          <div class="hr-h">{{ h }}</div>
          <div class="hr-hoop" :class="halfSealed(c, h) ? 'hoop-sealed' : 'hoop-' + c.hoops[h]">
            {{ halfSealed(c, h) ? '封停' : HOOP_META[c.hoops[h]].label }}
          </div>
        </div>

        <div v-if="halfSealed(c, h) || c.hoops[h] !== 'normal'" class="hr-body">
          <div class="hr-off">{{ halfSealed(c, h) ? '封场不可用' : c.hoops[h] === 'maintaining' ? '篮筐维修中' : '篮筐封停' }}</div>
          <div v-if="halfSealed(c, h)" class="hr-rule">受影响队伍已全额退款、可免费改约优先排位 <RuleLink id="R-SEAL-1" /></div>
          <div v-else class="hr-rule">已预约队伍自动改约/退款 <RuleLink id="R-WX-2" /></div>
        </div>

        <div v-else-if="currentOf(c, h)" class="hr-body">
          <div class="hr-main">
            <span class="hr-team">✅ {{ currentOf(c, h)!.teamName }}</span>
            <NTag v-if="currentOf(c, h)!.fixedTeam" size="tiny" type="info">固定队</NTag>
            <span :class="['hr-remain', remainBig(currentOf(c, h)!).cls]">{{ remainBig(currentOf(c, h)!).text }}</span>
          </div>
          <div class="hr-meta">
            {{ currentOf(c, h)!.start }}–{{ currentOf(c, h)!.end }} ·
            到场 {{ checkedInCount(currentOf(c, h)!) }}/{{ currentOf(c, h)!.members.length }} ·
            签到码 {{ currentOf(c, h)!.checkInCode }}
          </div>
          <div v-if="timeState(currentOf(c, h)!, nowStr).releasable" class="hr-release">
            ⏰ 开场超 20 分钟未签到 → 可释放给候补散客
            <NButton v-if="state.role === 'admin'" size="tiny" type="error" round style="margin-left:6px"
              @click="release(currentOf(c, h)!)">释放场地</NButton>
            <RuleLink id="R-FAIR-2" />
          </div>

          <!-- 全场人数不足自动调整（R-MERGE-2） -->
          <template v-if="currentOf(c, h)!.underfill && h === currentOf(c, h)!.halves[currentOf(c, h)!.halves.length - 1]">
            <!-- 队长选择中 / 超保留时间 -->
            <div v-if="currentOf(c, h)!.underfill?.stage === 'prompted'" class="hr-underfill">
              🧩 全场仅 {{ checkedInCount(currentOf(c, h)!) }} 人、{{ uf(currentOf(c, h)!)?.waitingPeople ?? 0 }} 名散客等待，
              队长保留至 {{ currentOf(c, h)!.underfill?.decideDeadline }}
              <template v-if="(uf(currentOf(c, h)!)?.keepRemaining ?? 0) <= 0">
                · <span style="color:#d03050;font-weight:700">已超时</span>
                <NButton v-if="state.role === 'admin'" size="tiny" type="warning" round style="margin-left:6px"
                  @click="releaseHalf(currentOf(c, h)!)">释放空闲半场</NButton>
              </template>
              <RuleLink id="R-MERGE-2" />
            </div>
            <!-- 队长已降半场待释放 -->
            <div v-else-if="currentOf(c, h)!.underfill?.stage === 'downgrade'" class="hr-underfill">
              📉 队长已降半场，空闲半场 {{ currentOf(c, h)!.underfill?.releasedHalf }} 待释放
              <NButton v-if="state.role === 'admin'" size="tiny" type="warning" round style="margin-left:6px"
                @click="releaseHalf(currentOf(c, h)!)">释放给候补散客</NButton>
            </div>
          </template>
          <!-- 释放后：中线边界 / 照明分摊 / 结束提醒 / 双方确认 -->
          <div v-if="pairBooking(currentOf(c, h)!)" class="hr-boundary">
            <div class="hb-line">
              🧭 中线分界：本侧 {{ currentOf(c, h)!.halves[0] }}
              <b>{{ currentOf(c, h)!.isWalkerAllocation ? '候补散客' : '原预约队' }}</b>
              ｜对侧 {{ pairBooking(currentOf(c, h)!)!.halves[0] }}
              <b>{{ currentOf(c, h)!.isWalkerAllocation ? '原预约队' : '候补散客' }}</b>
            </div>
            <div class="hb-line">💡 照明各按各半场计：本侧 ¥{{ money(liveFee(currentOf(c, h)!)) }} ｜对侧 ¥{{ money(liveFee(pairBooking(currentOf(c, h)!)!)) }}（8 折按签到人数平摊）</div>
            <div class="hb-line">⏰ {{ currentOf(c, h)!.end }} 同步结束，结束前 5 分钟提醒清场关灯
              <NTag size="tiny" :type="currentOf(c, h)!.underfill?.endReminded ? 'warning' : 'default'" round style="margin-left:4px">
                {{ currentOf(c, h)!.underfill?.endReminded ? '已推送结束提醒' : '待提醒' }}
              </NTag>
            </div>
            <div class="hb-line">
              ✅ 边界确认：
              <NTag size="tiny" :type="currentOf(c, h)!.underfill?.confirmedByTeam ? 'success' : 'warning'">原队{{ currentOf(c, h)!.underfill?.confirmedByTeam ? '✓' : '待确认' }}</NTag>
              <NTag size="tiny" :type="currentOf(c, h)!.underfill?.confirmedByWalker ? 'success' : 'warning'">散客{{ currentOf(c, h)!.underfill?.confirmedByWalker ? '✓' : '待确认' }}</NTag>
              <NTag v-if="boundaryConfirmed(currentOf(c, h)!)" size="tiny" type="success" round>双方已确认·防争抢</NTag>
            </div>
          </div>
          <div v-if="timeState(currentOf(c, h)!, nowStr).forceClearable" class="hr-release">
            🚨 超时超 15 分钟，管理员可强制清场并暂停其预约资格 7 天
            <NButton v-if="state.role === 'admin'" size="tiny" type="error" round style="margin-left:6px"
              @click="forceEnd(currentOf(c, h)!)">强制结束</NButton>
            <RuleLink id="R-OT-2" />
          </div>
        </div>

        <div v-else-if="nextOf(c, h)" class="hr-body idle">
          <div class="hr-main"><span class="hr-team">🕓 下一场：{{ nextOf(c, h)!.teamName }}</span></div>
          <div class="hr-meta">{{ nextOf(c, h)!.start }}–{{ nextOf(c, h)!.end }} · 当前空闲，散客可现场排队候补</div>
        </div>

        <div v-else class="hr-body idle">
          <div class="hr-main"><span class="hr-team">🟢 当前空闲</span></div>
          <div class="hr-meta">无预约，现场先到先用；工作人员可协助排队登记 <RuleLink id="R-FAIR-2" /></div>
        </div>
      </div>

      <div class="cb-foot">
        静音截止 {{ c.noiseCurfew }}:00 · {{ c.noiseSensitive[0] }}
        <NButton text size="tiny" type="primary" @click="openIncidents()">争议处理/投诉记录 →</NButton>
      </div>
    </div>

    <!-- 争议快速指引 -->
    <div class="dispute-guide">
      <div class="dg-title">⚖️ 发生争议时，这样判断该谁用</div>
      <div class="dg-step">1. 请双方出示<b>预约码 / 签到码</b>，核对预约记录与签到时间；</div>
      <div class="dg-step">2. 比对<b>时段与半场编号</b>：时段内已签到方使用，超时方立即让场；</div>
      <div class="dg-step">3. 时段重叠时按 <b>先到先得 + 信用分</b> 排序，未使用者当场退款 + 优先改约；</div>
      <div class="dg-step">4. 全过程记入调解时间线，双方可在「事件记录」查看结论。</div>
      <div style="margin-top:6px"><RuleLink id="R-DISPUTE-1" /> <RuleLink id="R-FAIR-4" /></div>
    </div>
  </div>
</template>

<style scoped>
.kpi { background:#fff; border-radius:10px; text-align:center; padding:10px 4px; }
.kpi-n { font-size:20px; font-weight:800; }
.kpi-l { font-size:11px; color:#909399; }
.court-board { background:#fff; border-radius:12px; padding:10px 12px; margin-bottom:10px; box-shadow:0 1px 4px rgba(0,0,0,.06); }
.cb-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; font-size:14px; }
.seal-line { background:#fff1f0; color:#cf1322; border-radius:8px; padding:6px 8px; font-size:12px; margin:6px 0; }
.half-row { display:flex; gap:10px; padding:10px 0; border-top:1px dashed #eee; }
.half-row.unusable { opacity:.85; }
.hr-half { min-width:52px; text-align:center; }
.hr-h { font-size:20px; font-weight:800; }
.hr-hoop { font-size:11px; border-radius:6px; padding:1px 4px; margin-top:2px; }
.hoop-normal { background:#e8f8ee; color:#18a058; }
.hoop-maintaining { background:#fff7e6; color:#d48806; }
.hoop-sealed { background:#fff1f0; color:#cf1322; }
.hr-body { flex:1; min-width:0; }
.hr-main { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.hr-team { font-weight:700; font-size:14px; }
.hr-remain { font-weight:800; font-size:15px; margin-left:auto; }
.r-ok { color:#18a058; }
.r-warn { color:#f0a020; }
.r-error { color:#d03050; }
.hr-meta { font-size:12px; color:#888; margin-top:3px; }
.hr-off { font-weight:700; color:#d03050; font-size:14px; }
.hr-rule { font-size:12px; color:#999; margin-top:2px; }
.hr-release { background:#fff7e6; border-radius:6px; padding:4px 6px; font-size:12px; color:#ad6800; margin-top:6px; display:flex; align-items:center; flex-wrap:wrap; }
.hr-underfill { background:#fff1f0; border:1px solid #ffccc7; border-radius:6px; padding:5px 7px; font-size:12px; color:#a8271e; margin-top:6px; line-height:1.8; }
.hr-boundary { background:#f0f7ff; border:1px solid #c6defa; border-radius:6px; padding:5px 7px; font-size:11.5px; color:#28517a; margin-top:6px; line-height:1.9; }
.hb-line { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
.idle .hr-team { color:#18a058; }
.cb-foot { display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#999; border-top:1px dashed #eee; padding-top:6px; }
.dispute-guide { background:#fff; border-radius:12px; padding:12px; box-shadow:0 1px 4px rgba(0,0,0,.06); font-size:12px; line-height:2; }
.dg-title { font-weight:700; font-size:13px; margin-bottom:4px; }
</style>
