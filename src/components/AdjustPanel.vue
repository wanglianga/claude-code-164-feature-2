<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NTag, NRadioGroup, NRadio, NAlert, NPopconfirm, NInput, useMessage } from 'naive-ui'
import type { Booking } from '../types'
import { useState, nowStr, chooseAdjust, rejectAdjust, confirmAdjust, appealAdjust, lightLive } from '../store'
import { adjustView, surrenderQuote, money, endReminder } from '../lib/engine'
import RuleLink from './RuleLink.vue'

const props = defineProps<{ booking: Booking }>()
const state = useState()
const message = useMessage()

const court = computed(() => state.courts.find(c => c.id === props.booking.courtId)!)
const view = computed(() => adjustView(props.booking, state.mergeRequests, nowStr.value))
const light = computed(() => lightLive(props.booking))
const sq = computed(() => surrenderQuote(props.booking, court.value, nowStr.value))
const walkerBooking = computed(() =>
  view.value?.releasedBookingId ? state.bookings.find(x => x.id === view.value!.releasedBookingId) : undefined)

const keptHalf = ref(props.booking.halves[0])
const showReject = ref(false)
const rejectReason = ref('')
const showAppeal = ref(false)
const appealText = ref('')

function doChoose(choice: 'merge' | 'half' | 'surrender') {
  chooseAdjust(props.booking.id, choice, choice === 'half' ? keptHalf.value : undefined)
  if (choice === 'merge') message.success('已接受候补散客拼场，到场签到即补齐人数')
  if (choice === 'half') message.success(`已降为半场（${keptHalf.value}），费用已分段重算`)
  if (choice === 'surrender') message.success('已按全场原价续用，不再释放半场')
}
function doReject() {
  rejectAdjust(props.booking.id, rejectReason.value)
  showReject.value = false
  rejectReason.value = ''
  message.warning('已拒绝调整：保留期内不释放，超时管理员可释放半场')
}
function doConfirm() {
  confirmAdjust(props.booking.id, 'captain')
  message.success('队长已确认新边界与照明分摊')
}
function doAppeal() {
  if (!appealText.value.trim()) return message.warning('请填写申诉理由')
  appealAdjust(props.booking.id, appealText.value)
  showAppeal.value = false
  appealText.value = ''
  message.success('申诉已提交，等待管理员复核')
}

const remainColor = computed(() => {
  if (!view.value) return ''
  return view.value.remaining <= 3 ? '#d03050' : view.value.remaining <= 8 ? '#f0a020' : '#18a058'
})
</script>

<template>
  <div class="adjust-panel" v-if="view">
    <!-- ===== 提示三选一 / 已拒绝 ===== -->
    <template v-if="view.status === 'prompting' || view.status === 'rejected'">
      <NAlert :type="view.adminReleasable ? 'error' : 'warning'" class="ap-alert">
        <div class="ap-title">
          ⚠️ 全场实际只到 <b>{{ view.present }}</b> 人（建议 8–14，触发线 {{ view.trigger }} 人），
          现场有 <b>{{ view.candidates.length }}</b> 组候补散客等待
        </div>
        <div class="ap-sub" v-if="!view.adminReleasable">
          请在保留期内选择，剩余
          <b :style="{ color: remainColor }">{{ Math.max(0, view.remaining) }} 分钟</b>
          （至 {{ view.promptedAt }} 起 {{ view.holdMinutes }} 分钟）<RuleLink id="R-MERGE-2" />
        </div>
        <div class="ap-sub" v-else>
          <b>保留期已过{{ view.status === 'rejected' ? '（你已拒绝调整）' : '' }}</b>，管理员可释放一个半场给候补散客
          <RuleLink id="R-MERGE-3" />
        </div>

        <div class="cand" v-for="r in view.candidates" :key="r.id">
          🙋 {{ r.walkerName }} 等 {{ r.people }} 人 · {{ r.time }} 候补
          <span class="cand-msg">“{{ r.message }}”</span>
        </div>
      </NAlert>

      <div class="ap-choose-label">保留哪个半场（降半场时生效）：</div>
      <NRadioGroup v-model:value="keptHalf" size="small" class="ap-halves">
        <NRadio v-for="h in booking.halves" :key="h" :value="h">{{ h }}</NRadio>
      </NRadioGroup>

      <div class="ap-actions">
        <NButton size="small" type="primary" round @click="doChoose('merge')">🤝 接受拼场（8 折照明）</NButton>
        <NButton size="small" type="success" ghost round @click="doChoose('half')">✂️ 降为半场（退押金差额）</NButton>
        <NPopconfirm @positive-click="doChoose('surrender')">
          <template #trigger>
            <NButton size="small" type="warning" ghost round>💳 坚持包场·补缴差额</NButton>
          </template>
          分界后按全场 2 个半场原价计、取消 8 折，预计至 {{ booking.end }} 比拼场多缴约
          ¥{{ money(sq?.toEnd ?? 0) }}。确定坚持包场？
        </NPopconfirm>
      </div>
      <div v-if="!showReject" class="ap-reject-line">
        <NButton text size="tiny" type="error" @click="showReject = true">不接受以上调整（拒绝）</NButton>
      </div>
      <div v-else class="ap-reject-box">
        <NInput v-model:value="rejectReason" size="small" type="textarea" :rows="2"
          placeholder="可填写拒绝理由；保留期内不释放，超时管理员仍可释放半场（R-MERGE-3）" />
        <div style="display:flex;gap:8px;margin-top:6px">
          <NButton size="tiny" type="error" round @click="doReject">确认拒绝</NButton>
          <NButton size="tiny" round @click="showReject = false">再想想</NButton>
        </div>
      </div>
    </template>

    <!-- ===== 已接受拼场 ===== -->
    <template v-else-if="view.status === 'merging'">
      <NAlert type="success" class="ap-alert">
        <div class="ap-title">🤝 已接受候补散客拼场（仍使用全场 {{ booking.halves.join('/') }}）</div>
        <div class="ap-sub">候补散客到场签到后即补齐人数，照明费按签到人数平摊并享 8 折 <RuleLink id="R-BOOK-2" /></div>
      </NAlert>
    </template>

    <!-- ===== 已降半场 / 已释放：边界、分摊、结束提醒、确认 ===== -->
    <template v-else-if="view.status === 'halved' || view.status === 'released' || view.status === 'confirmed'">
      <NAlert :type="view.bothConfirmed ? 'success' : 'info'" class="ap-alert">
        <div class="ap-title">
          {{ view.status === 'released' ? '✂️ 管理员已释放半场' : view.status === 'confirmed' ? '✅ 双方已确认边界' : '✂️ 已降为半场' }}
          （分界 {{ view.splitAt }}）
        </div>
        <!-- 场地边界 -->
        <div class="boundary">
          <div class="bd-side team">
            <div class="bd-h">{{ view.keptHalf }}</div>
            <div class="bd-who">本队 · {{ booking.teamName }}</div>
          </div>
          <div class="bd-mid">中线 / 围挡分界</div>
          <div class="bd-side walker">
            <div class="bd-h">{{ view.freedHalf }}</div>
            <div class="bd-who">候补散客{{ walkerBooking ? ' · ' + walkerBooking.teamName : '' }}</div>
          </div>
        </div>
        <!-- 照明分摊 -->
        <div class="share-title">💡 照明费用分摊（分界 {{ view.splitAt }}）<RuleLink id="R-MERGE-4" /></div>
        <div v-for="(s, i) in light?.segments ?? []" :key="i" class="share-line">
          <span>{{ s.label }}</span>
          <b>¥{{ money(s.fee) }}</b>
        </div>
        <div class="share-line share-total">
          <span>本队照明合计 / 押金 ¥{{ booking.lighting.deposit }}（{{ view.keptHalf }} 半场自付，签到人均摊）</span>
          <b style="color:#e8840c">¥{{ money(light?.fee ?? 0) }}</b>
        </div>
        <!-- 结束提醒 -->
        <div class="end-tip" :class="{ hot: endReminder(booking, nowStr) }">
          ⏰ {{ endReminder(booking, nowStr) ? '距结束不足 10 分钟，请准备清场' : `结束时间 ${booking.end}，结束前 10 分钟提醒；结束后 5 分钟清场缓冲` }}
        </div>
        <!-- 双方确认状态 -->
        <div class="confirm-row">
          <NTag size="small" :type="view.captainConfirmed ? 'success' : 'default'" round>
            {{ view.captainConfirmed ? '✅ 队长已确认' : '⏳ 队长待确认' }}
          </NTag>
          <NTag size="small" :type="view.walkerConfirmed ? 'success' : 'default'" round>
            {{ view.walkerConfirmed ? '✅ 散客已确认' : '⏳ 散客待确认' }}
          </NTag>
        </div>
        <div v-if="!view.captainConfirmed" style="margin-top:8px">
          <NButton size="small" type="primary" round @click="doConfirm">我（队长）确认边界与分摊</NButton>
        </div>
        <div v-if="view.status === 'released' && !view.appealed" style="margin-top:8px">
          <NButton v-if="!showAppeal" text size="tiny" type="warning" @click="showAppeal = true">
            对释放有异议？24 小时内提交申诉 <RuleLink id="R-MERGE-3" />
          </NButton>
          <div v-else>
            <NInput v-model:value="appealText" size="small" type="textarea" :rows="2" placeholder="填写申诉理由，管理员将复核" />
            <div style="display:flex;gap:8px;margin-top:6px">
              <NButton size="tiny" type="warning" round @click="doAppeal">提交申诉</NButton>
              <NButton size="tiny" round @click="showAppeal = false">取消</NButton>
            </div>
          </div>
        </div>
        <div v-if="view.appealed" class="appealed">📝 申诉已提交，等待管理员在事件工单中复核裁决</div>
      </NAlert>
    </template>

    <!-- ===== 坚持包场 ===== -->
    <template v-else-if="view.status === 'surrendered'">
      <NAlert type="warning" class="ap-alert">
        <div class="ap-title">💳 已选择坚持包场（全场 {{ booking.halves.join('/') }}）</div>
        <div class="ap-sub">
          分界 {{ view.splitAt }} 起取消拼场 8 折、按全场 2 个半场原价计费；当前已累计上浮约
          <b>¥{{ money(sq?.amount ?? 0) }}</b>（{{ sq?.minutes ?? 0 }} 分钟），半场未释放。
          <RuleLink id="R-MERGE-2" />
        </div>
      </NAlert>
    </template>
  </div>
</template>

<style scoped>
.adjust-panel { margin: 8px 0 10px; }
.ap-alert { border-radius: 10px; }
.ap-title { font-size: 13px; line-height: 1.6; }
.ap-sub { font-size: 12px; margin-top: 4px; line-height: 1.6; color: inherit; opacity: .92; }
.cand { font-size: 12px; margin-top: 6px; background: rgba(255,255,255,.7); border-radius: 6px; padding: 4px 8px; }
.cand-msg { color: #888; margin-left: 4px; }
.ap-choose-label { font-size: 12px; color: #666; margin: 8px 0 4px; }
.ap-halves { display: flex; gap: 10px; }
.ap-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.ap-reject-line { margin-top: 8px; text-align: right; }
.ap-reject-box { margin-top: 8px; background: #fff7f6; border-radius: 8px; padding: 8px; }
.boundary { display: flex; align-items: stretch; gap: 6px; margin: 8px 0; }
.bd-side { flex: 1; border-radius: 8px; padding: 8px 6px; text-align: center; }
.bd-side.team { background: #eaf4ff; border: 1px solid #b6d8ff; }
.bd-side.walker { background: #eafaf0; border: 1px solid #b6ebc9; }
.bd-h { font-size: 20px; font-weight: 800; }
.bd-who { font-size: 11px; color: #555; margin-top: 2px; line-height: 1.4; }
.bd-mid { align-self: center; font-size: 10.5px; color: #999; writing-mode: horizontal-tb; text-align: center; width: 42px; }
.share-title { font-size: 12px; font-weight: 700; margin: 8px 0 4px; }
.share-line { display: flex; justify-content: space-between; font-size: 12px; line-height: 1.9; }
.share-total { border-top: 1px dashed rgba(0,0,0,.12); padding-top: 4px; margin-top: 2px; }
.end-tip { font-size: 12px; background: rgba(255,255,255,.7); border-radius: 6px; padding: 5px 8px; margin-top: 6px; }
.end-tip.hot { color: #d03050; font-weight: 700; }
.confirm-row { display: flex; gap: 8px; margin-top: 8px; }
.appealed { font-size: 12px; color: #ad6800; margin-top: 6px; }
</style>
