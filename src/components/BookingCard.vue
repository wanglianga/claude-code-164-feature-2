<script setup lang="ts">
import { computed } from 'vue'
import {
  NButton, NCollapse, NCollapseItem, NDivider, NGrid, NGridItem, NProgress, NTag, NText
} from 'naive-ui'
import type { Booking } from '../types'
import {
  STATUS_META, PAY_META, FEE_META, checkedInCount, feeSummary,
  fmt, hm, isActive, money, timeState,
  underfillView, boundaryPair, boundaryConfirmed
} from '../lib/engine'
import { courtById, lightLive, nowStr, useState } from '../store'
import RuleLink from './RuleLink.vue'
import RiskTag from './RiskTag.vue'
import { bookingRisk } from '../lib/engine'

const props = defineProps<{
  booking: Booking
  showCourt?: boolean
  compact?: boolean
}>()

const state = useState()
const court = computed(() => courtById(props.booking.courtId))
const light = computed(() => lightLive(props.booking))
const ts = computed(() => timeState(props.booking, nowStr.value))
const risk = computed(() => bookingRisk(props.booking, state.incidents, nowStr.value))
const present = computed(() => checkedInCount(props.booking))
const summary = computed(() => feeSummary(props.booking, court.value, nowStr.value, !!light.value?.frozen))

// 全场人数不足自动调整（R-MERGE-2）
const uf = computed(() => underfillView(props.booking, state.mergeRequests, nowStr.value))
const pair = computed(() => boundaryPair(props.booking, state.bookings))
const teamSide = computed(() => pair.value ? (pair.value.self.splitFromId ? pair.value.other : pair.value.self) : null)
const walkerSide = computed(() => pair.value ? (pair.value.self.splitFromId ? pair.value.self : pair.value.other) : null)
const teamLight = computed(() => (teamSide.value ? lightLive(teamSide.value) : null))
const walkerLight = computed(() => (walkerSide.value ? lightLive(walkerSide.value) : null))
const isWalkerSide = computed(() => !!props.booking.isWalkerAllocation)
const confirmedAll = computed(() => boundaryConfirmed(props.booking))

const remainText = computed(() => {
  if (props.booking.status === 'booked') {
    return ts.value.untilStart > 0 ? `距开场 ${fmt(ts.value.untilStart)}` : '已到开场时间'
  }
  if (!isActive(props.booking, nowStr.value)) return ''
  if (ts.value.overtimeMinutes > 0) return `已超时 ${ts.value.overtimeMinutes} 分钟`
  if (ts.value.inGrace) return '清场缓冲中（5 分钟）'
  return `还能打 ${fmt(ts.value.remaining)}`
})

const remainType = computed(() => {
  if (ts.value.overtimeMinutes > 0) return 'error'
  if (ts.value.inGrace) return 'warning'
  if (ts.value.remaining <= 15) return 'warning'
  return 'success'
})

const progress = computed(() => {
  const total = hm(props.booking.end) - hm(props.booking.start)
  const used = Math.min(total, Math.max(0, hm(nowStr.value) - hm(props.booking.start)))
  return total > 0 ? Math.round((used / total) * 100) : 0
})
</script>

<template>
  <div class="booking-card">
    <div class="bc-head">
      <div>
        <span class="bc-team">{{ booking.teamName }}</span>
        <NTag v-if="booking.fixedTeam" size="tiny" type="info" round style="margin-left:6px">固定球队</NTag>
        <NTag v-else size="tiny" round style="margin-left:6px">散客/临时</NTag>
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
        <RiskTag :level="risk.level" :reasons="risk.reasons" />
        <NTag :type="STATUS_META[booking.status].type" size="small" round>{{ STATUS_META[booking.status].label }}</NTag>
      </div>
    </div>

    <div class="bc-row">
      <span class="bc-label">场地</span>
      <span v-if="showCourt !== false">{{ court.name }} · {{ booking.scope === 'full' ? '全场' : '半场' }} {{ booking.halves.join('+') }}</span>
      <span v-else>{{ booking.scope === 'full' ? '全场' : '半场' }} {{ booking.halves.join('+') }}</span>
      <span style="flex:1"></span>
      <NText depth="3" style="font-size:12px">{{ booking.date }} {{ booking.start }}–{{ booking.end }}</NText>
    </div>

    <!-- 进行中：剩余时间大字 + 进度条 -->
    <div v-if="isActive(booking, nowStr) || booking.status === 'booked'" class="bc-live">
      <div class="bc-remain" :class="'r-' + remainType">{{ remainText }}</div>
      <NProgress
        v-if="isActive(booking, nowStr)"
        type="line" :percentage="progress" :show-indicator="false"
        :status="remainType === 'error' ? 'error' : remainType === 'warning' ? 'warning' : 'success'"
        :height="6" />
    </div>

    <NGrid :cols="3" :x-gap="8" class="bc-stats">
      <NGridItem>
        <div class="stat-num">{{ present }}/{{ booking.members.length }}</div>
        <div class="stat-label">实际到场/名单</div>
      </NGridItem>
      <NGridItem>
        <div class="stat-num">{{ light ? light.minutes + ' 分' : '—' }}</div>
        <div class="stat-label">照明已用时长</div>
      </NGridItem>
      <NGridItem>
        <div class="stat-num" :style="{ color: light ? '#e8840c' : undefined }">
          {{ light ? '¥' + money(light.fee) : '¥0' }}
        </div>
        <div class="stat-label">照明费{{ light?.frozen ? '（已冻结）' : '（实时）' }}</div>
      </NGridItem>
    </NGrid>

    <div class="bc-row" v-if="light">
      <span class="bc-label">照明</span>
      <span style="font-size:12px">
        {{ booking.lighting.onAt }} 开灯 ·
        单价 ¥{{ court.lighting.pricePerMinute }}/分钟{{ booking.scope === 'full' ? ' × 2 半场' : '' }}
        <template v-if="light.rate < 1"> · 拼场 8 折</template>
        · 人均约 ¥{{ money(light.perPerson) }}
      </span>
    </div>
    <div class="bc-row">
      <span class="bc-label">支付</span>
      <NTag :type="PAY_META[booking.payStatus].type" size="tiny" round>{{ PAY_META[booking.payStatus].label }}</NTag>
      <span style="flex:1"></span>
      <span style="font-size:12px">押金 ¥{{ booking.lighting.deposit }}</span>
    </div>

    <div v-if="summary.items.length > 0 || light" class="bc-fees">
      <div v-for="(f, i) in summary.items" :key="i" class="fee-line">
        <span>
          <NTag size="tiny" :type="FEE_META[f.kind]?.type ?? 'default'">{{ FEE_META[f.kind]?.label ?? f.label }}</NTag>
          <span class="fee-note">{{ f.note }}</span>
        </span>
        <span :style="{ color: f.amount < 0 ? '#18a058' : '#d03050', fontWeight: 600 }">
          {{ f.amount < 0 ? '-' : '+' }}¥{{ money(Math.abs(f.amount)) }}
        </span>
      </div>
      <div v-if="light" class="fee-line fee-light-live">
        <span>照明实时累计 <RuleLink id="R-LIGHT-1" /></span>
        <span style="color:#e8840c;font-weight:700">¥{{ money(light.fee) }}</span>
      </div>
      <div class="fee-line fee-total">
        <span>当前应计合计 / 押金</span>
        <span :style="{ color: summary.depositBalance < 0 ? '#d03050' : '#18a058', fontWeight: 700 }">
          ¥{{ money(summary.charges) }} / ¥{{ summary.deposit }}
          （<template v-if="isActive(booking, nowStr)">{{ summary.depositBalance < 0 ? '结束时需补缴 ¥' + money(-summary.depositBalance) : '预计可退 ¥' + money(summary.depositBalance) }}</template><template v-else>{{ summary.depositBalance < 0 ? '需补缴 ¥' + money(-summary.depositBalance) : '可退 ¥' + money(summary.depositBalance) }}</template>）
        </span>
      </div>
    </div>

    <!-- 全场人数不足自动调整（R-MERGE-2） -->
    <div v-if="uf && booking.underfill && booking.underfill.stage === 'prompted'" class="uf-box">
      <div class="uf-title">🧩 全场人数不足，请队长调整（实际到场 {{ uf.present }} 人）</div>
      <div class="uf-desc">
        预约全场但仅 {{ uf.present }} 人到场，<b>{{ uf.waitingPeople }} 名散客正在等待加入</b>。
        请在 <b :class="uf.keepRemaining <= 0 ? 'uf-over' : ''">{{ booking.underfill.decideDeadline }}</b>
        前选择：接受拼场 / 降为半场（退押金差额 ¥{{ money(uf.depositDiff) }}）/ 补缴全场保留费 ¥{{ uf.keepFee }}。
      </div>
      <div v-if="uf.keepRemaining <= 0" class="uf-overline">
        已超过保留时间，管理员可释放空闲半场给候补散客 <RuleLink id="R-MERGE-2" />
      </div>
      <div class="uf-rule"><RuleLink id="R-MERGE-2" /></div>
    </div>

    <div v-else-if="uf && booking.underfill?.stage === 'keep'" class="uf-box keep">
      <div class="uf-title">💰 已补缴全场保留费，继续独占全场</div>
      <div class="uf-desc">队长选择继续包全场，已收保留费 ¥{{ uf.keepFee }}；结果已同步候补散客与投诉工单，社区 24 小时内答复。<RuleLink id="R-FAIR-3" /></div>
    </div>

    <!-- 释放半场后：中线边界 / 照明分摊 / 结束提醒 / 双方确认 -->
    <div v-if="pair && teamSide && walkerSide" class="boundary-box">
      <div class="bd-title">🧭 半场已拆分 · 中线边界与照明分摊（R-MERGE-2）</div>
      <div class="bd-court">
        <div class="bd-half" :class="{ me: !isWalkerSide }">
          <div class="bd-h">{{ teamSide.halves[0] }}</div>
          <div class="bd-t">{{ teamSide.teamName }}</div>
          <div class="bd-m">原预约队伍 · {{ checkedInCount(teamSide) }} 人在场</div>
        </div>
        <div class="bd-line">中线<div class="bd-line-sub">勿越界</div></div>
        <div class="bd-half walker" :class="{ me: isWalkerSide }">
          <div class="bd-h">{{ walkerSide.halves[0] }}</div>
          <div class="bd-t">{{ walkerSide.teamName }}</div>
          <div class="bd-m">候补散客组 · {{ checkedInCount(walkerSide) }} 人在场</div>
        </div>
      </div>
      <div class="bd-fee">
        💡 各组按自己半场独立计量照明（{{ court.lighting.pricePerMinute }} 元/分钟，拼场 8 折按签到人数平摊）：
        原队侧 <b :class="{ me_fee: !isWalkerSide }">¥{{ money(teamLight?.fee ?? 0) }}</b>
        ｜散客侧 <b :class="{ me_fee: isWalkerSide }">¥{{ money(walkerLight?.fee ?? 0) }}</b>
      </div>
      <div class="bd-end">⏰ 双方同一时段 {{ booking.end }} 结束，结束前 5 分钟推送清场关灯提醒</div>
      <div class="bd-confirm">
        <NTag size="tiny" :type="booking.underfill?.confirmedByTeam ? 'success' : 'warning'">
          原队{{ booking.underfill?.confirmedByTeam ? '已确认' : '待确认' }}
        </NTag>
        <NTag size="tiny" :type="booking.underfill?.confirmedByWalker ? 'success' : 'warning'">
          散客{{ booking.underfill?.confirmedByWalker ? '已确认' : '待确认' }}
        </NTag>
        <NTag v-if="confirmedAll" size="tiny" type="success" round>双方均已确认 · 越界按争抢处理</NTag>
      </div>
    </div>

    <div v-if="booking.adminNote" class="bc-admin-note">
      <b>管理员说明：</b>{{ booking.adminNote }}
    </div>

    <div v-if="$slots.actions" class="bc-actions">
      <slot name="actions" />
    </div>

    <NCollapse v-if="!compact">
      <NCollapseItem title="权益/核验记录时间线 · 签到码 {{ booking.checkInCode }}" name="tl">
        <div class="tl">
          <div v-for="(t, i) in booking.timeline" :key="i" class="tl-item">
            <span class="tl-dot" :class="'dot-' + (t.tone ?? 'default')"></span>
            <span class="tl-at">{{ t.at }}</span>
            <span>{{ t.text }}</span>
          </div>
        </div>
        <NDivider style="margin:8px 0" />
        <div style="font-size:12px;color:#666;line-height:1.8">
          队长 {{ booking.captainName }} {{ booking.captainPhone }} · 信用分 {{ booking.credit }}
          <template v-if="booking.lockerNos?.length"> · 更衣柜 {{ booking.lockerNos.join('、') }}号</template>
        </div>
        <div v-if="!compact" style="margin-top:6px">
          <template v-for="f in booking.fees" :key="f.kind + f.label">
            <RuleLink :id="f.ruleId" />
          </template>
        </div>
      </NCollapseItem>
    </NCollapse>
  </div>
</template>

<style scoped>
.booking-card {
  background: #fff;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 10px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
.bc-head { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px; }
.bc-team { font-weight: 700; font-size: 15px; }
.bc-row { display:flex; align-items:center; gap:6px; font-size:13px; margin:4px 0; color:#333; }
.bc-label { color:#999; font-size:12px; min-width:34px; }
.bc-live { margin:8px 0; }
.bc-remain { font-size:22px; font-weight:800; margin-bottom:4px; }
.r-success { color:#18a058; }
.r-warning { color:#f0a020; }
.r-error { color:#d03050; }
.bc-stats { background:#f7f9fc; border-radius:10px; padding:8px 4px; margin:8px 0; text-align:center; }
.stat-num { font-size:17px; font-weight:700; }
.stat-label { font-size:11px; color:#909399; margin-top:2px; }
.bc-fees { border-top:1px dashed #e5e6eb; margin-top:8px; padding-top:8px; }
.fee-line { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:12px; margin:5px 0; }
.fee-note { color:#999; margin-left:6px; }
.fee-light-live { color:#e8840c; }
.fee-total { border-top:1px solid #f0f0f0; padding-top:6px; margin-top:6px; font-size:13px; }
.bc-admin-note { background:#fff7e6; border:1px solid #ffe7ba; border-radius:8px; padding:8px; font-size:12px; line-height:1.7; margin-top:8px; color:#7a4d00; }
.uf-box { background:linear-gradient(135deg,#fff7e6,#fff1f0); border:1px solid #ffd591; border-radius:10px; padding:9px 10px; margin-top:8px; font-size:12px; line-height:1.7; }
.uf-box.keep { background:#f6ffed; border-color:#b7eb8f; }
.uf-title { font-weight:700; font-size:13px; color:#ad4e00; margin-bottom:3px; }
.uf-desc { color:#6b4a12; }
.uf-over { color:#d03050; }
.uf-overline { margin-top:5px; color:#d03050; font-weight:600; }
.uf-rule { margin-top:3px; }
.boundary-box { background:linear-gradient(135deg,#eef6ff,#f4f0ff); border:1px solid #c6defa; border-radius:10px; padding:10px; margin-top:8px; font-size:12px; line-height:1.7; }
.bd-title { font-weight:700; font-size:13px; color:#1d4e89; margin-bottom:7px; }
.bd-court { display:flex; align-items:stretch; gap:6px; }
.bd-half { flex:1; border:2px dashed #9fc3f0; border-radius:9px; padding:7px 6px; text-align:center; background:rgba(255,255,255,.65); }
.bd-half.walker { border-color:#b7a0e6; }
.bd-half.me { border-style:solid; box-shadow:0 0 0 2px rgba(24,160,88,.25); }
.bd-h { font-size:19px; font-weight:800; color:#1d4e89; }
.bd-half.walker .bd-h { color:#6b3fa0; }
.bd-t { font-weight:700; font-size:12px; margin-top:2px; }
.bd-m { font-size:11px; color:#777; }
.bd-line { align-self:center; font-weight:800; color:#d03050; font-size:11px; text-align:center; }
.bd-line-sub { font-size:10px; color:#aaa; font-weight:400; }
.bd-fee { margin-top:7px; color:#33506e; }
.me_fee { color:#18a058; }
.bd-end { color:#a06a00; margin-top:2px; }
.bd-confirm { display:flex; gap:5px; flex-wrap:wrap; margin-top:6px; }
.bc-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
.tl { position:relative; padding-left:4px; }
.tl-item { position:relative; padding-left:16px; font-size:12px; line-height:1.8; color:#444; }
.tl-dot { position:absolute; left:2px; top:8px; width:7px; height:7px; border-radius:50%; background:#c0c4cc; }
.dot-success { background:#18a058; }
.dot-warning { background:#f0a020; }
.dot-error { background:#d03050; }
.dot-info { background:#2080f0; }
.tl-at { color:#999; margin-right:6px; font-variant-numeric:tabular-nums; }
</style>
