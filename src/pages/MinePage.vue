<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  NButton, NTag, NEmpty, NInput, NForm, NFormItem, NCheckbox,
  NInputNumber, NAlert, NSpace, NPopconfirm, NDivider, useMessage, NBadge
} from 'naive-ui'
import {
  useState, nowStr, addMember, toggleCheckIn, respondMerge,
  payDeposit, turnOnLight, endUsage, topUp, applyMerge, checkInByCode,
  decideUnderfill, confirmBoundary, addUnderfillComplaint
} from '../store'
import {
  checkedInCount, rejectMergeCheck, hm, isActive, timeState,
  underfillView, boundaryConfirmed
} from '../lib/engine'
import type { Booking, MergeRequest } from '../types'
import BookingCard from '../components/BookingCard.vue'
import BottomSheet from '../components/BottomSheet.vue'
import RuleLink from '../components/RuleLink.vue'

const state = useState()
const message = useMessage()

const isCaptain = computed(() => state.role === 'captain')
const isWalkin = computed(() => state.role === 'walkin')

// 队长视角：陈晨（演示）/新建预约，以及需要队长处置或处置中的"全场人数不足"场次（R-MERGE-2）
const myBookings = computed<Booking[]>(() =>
  state.bookings
    .filter(b => b.captainName === '陈晨' || b.captainId === 'u-me' || !!b.underfill)
    .sort((a, b) => hm(b.start) - hm(a.start)))

// 待处理拼场申请（排除已进入"人数不足调整"流程的场次——改由三选一入口处理）
const pendingRequests = computed<MergeRequest[]>(() =>
  state.mergeRequests.filter(r =>
    r.status === 'pending' && myBookings.value.some(b => b.id === r.bookingId) &&
    state.bookings.find(b => b.id === r.bookingId)?.underfill?.stage !== 'prompted'))

// 全场人数不足待选择的场次
const underfillBookings = computed(() =>
  myBookings.value.filter(b => b.underfill?.stage === 'prompted'))

// 释放后待本队确认边界的场次
function needTeamConfirm(b: Booking) {
  return b.underfill?.stage === 'released' && !b.underfill.confirmedByTeam
}

// 邀请队员
const inviteTarget = ref<Booking | null>(null)
const inviteForm = ref({ name: '', phone: '', minor: false })
function submitInvite() {
  if (!inviteTarget.value || !inviteForm.value.name.trim()) return message.warning('请填写队员姓名')
  addMember(inviteTarget.value.id, inviteForm.value.name, inviteForm.value.phone, inviteForm.value.minor)
  message.success('已发送签到邀请，队员到场凭签到码签到')
  inviteForm.value = { name: '', phone: '', minor: false }
}

// 拒绝拼场
const rejectTarget = ref<{ req: MergeRequest; booking: Booking } | null>(null)
const rejectReason = ref('')
const rejectHint = computed(() => rejectTarget.value
  ? rejectMergeCheck(rejectTarget.value.booking, rejectTarget.value.req)
  : null)
function openReject(req: MergeRequest) {
  const booking = state.bookings.find(b => b.id === req.bookingId)!
  rejectTarget.value = { req, booking }
  rejectReason.value = ''
}
function submitReject(unreasonable: boolean) {
  if (!rejectTarget.value) return
  if (!unreasonable && !rejectReason.value.trim()) {
    return message.warning('请先填写正当理由；若确实没有理由，请点下方"坚持拒绝"')
  }
  respondMerge(rejectTarget.value.req.id, false, unreasonable ? '' : rejectReason.value)
  rejectTarget.value = null
  message.success('已提交')
}
function acceptMergeReq(req: MergeRequest) {
  respondMerge(req.id, true)
  message.success('已同意拼场，请等待散客到场签到')
}

// 全场人数不足三选一（R-MERGE-2）
function choose(b: Booking, choice: 'merge' | 'downgrade' | 'keep') {
  decideUnderfill(b.id, choice)
  if (choice === 'merge') message.success('已接受散客拼场，照明 8 折按签到人数平摊')
  else if (choice === 'downgrade') message.success('已降为半场，押金差额当场退还')
  else message.success('已收取全场保留费，可继续使用全场')
}
function doConfirmTeam(b: Booking) {
  confirmBoundary(b.id, 'team')
  message.success('本队已确认中线边界与照明分摊')
}

// 散客对释放半场的边界确认
function doConfirmWalker(b: Booking) {
  confirmBoundary(b.id, 'walker')
  message.success('散客侧已确认中线边界与照明分摊')
}

// 散客提交投诉/异议（投诉入口随释放状态更新）
const complaintTarget = ref<Booking | null>(null)
const complaintText = ref('')
function submitComplaint() {
  if (!complaintTarget.value) return
  if (!complaintText.value.trim()) return message.warning('请填写异议内容')
  addUnderfillComplaint(complaintTarget.value.id, complaintText.value.trim())
  complaintTarget.value = null
  complaintText.value = ''
  message.success('异议已提交到工单，社区工作人员 24 小时内答复')
}

// 照明 / 结算
function doPay(b: Booking) { payDeposit(b.id); message.success('押金支付成功，到场可开灯') }
function doLightOn(b: Booking) {
  if (checkedInCount(b) === 0) return message.warning('请先完成至少 1 人签到再开灯')
  turnOnLight(b.id); message.success('照明已开启，开始实时计费')
}
function doEnd(b: Booking) {
  const r = endUsage(b.id)
  if (r.needTopup > 0) message.warning(`需补缴 ¥${r.needTopup.toFixed(2)}，请在离场前结清`)
  else message.success(`已关灯结算，押金退回 ¥${r.balance.toFixed(2)}`)
}
function doTopUp(b: Booking) { topUp(b.id); message.success('已补缴结清') }

// 散客：找拼场（排除已现场分配给自己的释放半场）
const mergeable = computed(() =>
  state.bookings
    .filter(b => b.acceptMerge && ['booked', 'ongoing'].includes(b.status) && !b.isWalkerAllocation)
    .filter(b => {
      const c = state.courts.find(x => x.id === b.courtId)!
      return !c.sealed && b.members.length < (b.scope === 'full' ? 14 : 8)
    })
    .sort((a, b) => hm(a.start) - hm(b.start)))

const applyTarget = ref<Booking | null>(null)
const applyForm = ref({ name: '王同学', phone: '150****3321', people: 1, message: '', minor: false })
function submitApply() {
  if (!applyTarget.value) return
  if (applyForm.value.minor && !applyForm.value.message.includes('监护人')) {
    return message.warning('未成年人参加夜场须监护人陪同，请在留言中说明（R-MINOR-1）')
  }
  applyMerge(applyTarget.value.id, applyForm.value.name, applyForm.value.phone,
    applyForm.value.people, applyForm.value.message, applyForm.value.minor)
  message.success('拼场申请已发送，队长须在 10 分钟内处理')
  applyTarget.value = null
}
const myApplications = computed(() =>
  state.mergeRequests.filter(r => r.walkerName === '王同学' || r.walkerPhone === applyForm.value.phone))

// 散客视角：已获管理员现场分配的释放半场（R-MERGE-2）
const myAllocations = computed<Booking[]>(() =>
  state.bookings
    .filter(b => b.isWalkerAllocation || b.captainId === 'u-walker')
    .sort((a, b) => hm(b.start) - hm(a.start)))

// 散客视角：正在候补等待（含队长尚未处理/超时待释放）的全场人数不足场次
const myWaitingUnderfill = computed(() =>
  myApplications.value
    .filter(r => r.status === 'pending')
    .map(r => state.bookings.find(b => b.id === r.bookingId))
    .filter((b): b is Booking => !!b && b.scope === 'full'))

// 签到码自助签到
const codeForm = ref({ code: '', name: '王同学' })
function doCodeCheckIn() {
  if (!codeForm.value.code.trim()) return message.warning('请输入 6 位签到码')
  const ok = checkInByCode(codeForm.value.code.trim(), codeForm.value.name)
  if (ok) { message.success('签到成功！'); codeForm.value.code = '' }
  else message.error('签到码无效，请向队长确认')
}

function courtName(id: string) { return state.courts.find(c => c.id === id)?.name ?? '' }
</script>

<template>
  <div class="page">
    <!-- ============ 队长视角 ============ -->
    <template v-if="isCaptain">
      <NAlert type="info" :show-icon="false" style="margin-bottom:10px;border-radius:10px">
        <div style="font-size:12px">你是队长：可<b>邀请队员、处理拼场申请、管理签到、开关照明并结算</b>。签到码展示在每张卡片的时间线标题中。</div>
      </NAlert>

      <!-- 全场人数不足待调整（R-MERGE-2） -->
      <div v-if="underfillBookings.length" class="section-title">
        <NBadge :value="underfillBookings.length" type="warning" processing />
        <span style="margin-left:8px">全场人数不足 · 待选择调整方式</span>
      </div>
      <NAlert v-for="b in underfillBookings" :key="'uf-' + b.id" type="warning" style="margin-bottom:10px;border-radius:12px">
        <div style="font-size:12.5px;line-height:1.8">
          <b>{{ b.teamName }}</b>（{{ courtName(b.courtId) }} {{ b.halves.join('+') }} 全场）实际仅
          <b style="color:#d03050">{{ checkedInCount(b) }} 人</b>到场，
          <b>{{ underfillView(b, state.mergeRequests, nowStr)?.waitingPeople ?? 0 }} 名散客正在等待</b>。
          请在 <b>{{ b.underfill?.decideDeadline }}</b> 前选择（<RuleLink id="R-MERGE-2" />）：
        </div>
        <div class="uf-choices">
          <NButton size="small" type="primary" round @click="choose(b, 'merge')">① 接受拼场（8 折平摊）</NButton>
          <NButton size="small" type="success" round @click="choose(b, 'downgrade')">② 降为半场（退 ¥{{ underfillView(b, state.mergeRequests, nowStr)?.depositDiff }} 差额）</NButton>
          <NButton size="small" type="warning" round @click="choose(b, 'keep')">③ 补缴 ¥{{ underfillView(b, state.mergeRequests, nowStr)?.keepFee }} 保留全场</NButton>
        </div>
      </NAlert>

      <!-- 待处理拼场申请 -->
      <div v-if="pendingRequests.length" class="section-title">
        <NBadge :value="pendingRequests.length" type="warning" processing />
        <span style="margin-left:8px">待处理拼场申请（10 分钟内响应）</span>
      </div>
      <div v-for="req in pendingRequests" :key="req.id" class="merge-req">
        <div class="mr-head">
          <b>🙋 {{ req.walkerName }} 等 {{ req.people }} 人</b>
          <NTag size="tiny" type="warning">申请于 {{ req.time }}</NTag>
        </div>
        <div class="mr-team">申请加入：{{ state.bookings.find(b => b.id === req.bookingId)?.teamName }}</div>
        <div class="mr-msg">“{{ req.message }}”</div>
        <div v-if="req.minor" class="mr-minor">含未成年人 · 夜场须监护人陪同 <RuleLink id="R-MINOR-1" /></div>
        <div class="mr-actions">
          <NButton size="small" type="primary" round @click="acceptMergeReq(req)">同意拼场（8 折照明）</NButton>
          <NButton size="small" round type="error" ghost @click="openReject(req)">拒绝并填写理由</NButton>
        </div>
        <div style="font-size:11px;color:#999;margin-top:4px">
          同意后照明费按签到人数平摊；无正当理由拒绝收 20 元资源占用费、信用 -5 <RuleLink id="R-MERGE-1" />
        </div>
      </div>

      <div class="section-title">我的队伍预约</div>
      <NEmpty v-if="myBookings.length === 0" description="还没有预约，去场地页约一场吧" />

      <div v-for="b in myBookings" :key="b.id">
        <BookingCard :booking="b">
          <template #actions>
            <!-- 待开场 -->
            <template v-if="b.status === 'booked'">
              <NButton size="small" round @click="inviteTarget = b">👋 邀请队员</NButton>
              <NButton size="small" round @click="inviteTarget = b">✅ 队员签到</NButton>
              <NButton v-if="b.lighting.deposit === 0" size="small" round type="warning" @click="doPay(b)">💳 支付照明押金</NButton>
              <NButton size="small" round type="primary" @click="doLightOn(b)">💡 到场开灯</NButton>
            </template>
            <!-- 进行中 / 迟到 / 超时 -->
            <template v-else-if="isActive(b, nowStr)">
              <NButton size="small" round @click="inviteTarget = b">✅ 签到管理（{{ checkedInCount(b) }}/{{ b.members.length }}）</NButton>
              <NButton v-if="needTeamConfirm(b)" size="small" type="primary" round @click="doConfirmTeam(b)">
                🧭 确认中线边界/照明分摊
              </NButton>
              <NPopconfirm @positive-click="doEnd(b)">
                <template #trigger>
                  <NButton size="small" round type="error" ghost>🔚 结束使用并关灯</NButton>
                </template>
                关灯后按实际使用时长立即结算照明费，押金余额 1–3 个工作日退回。确定现在结束？
              </NPopconfirm>
              <NTag v-if="timeState(b, nowStr).overtimeMinutes > 0" type="error" size="small" round>
                超时 {{ timeState(b, nowStr).overtimeMinutes }} 分钟 · ¥2/分钟
              </NTag>
            </template>
            <!-- 已结算需补缴 -->
            <template v-else>
              <NButton v-if="b.payStatus === 'deducted'" size="small" type="error" round @click="doTopUp(b)">
                💸 离场前补缴
              </NButton>
              <NTag v-else size="small" type="success" round>已完成</NTag>
            </template>
          </template>
        </BookingCard>
      </div>
    </template>

    <!-- ============ 散客视角 ============ -->
    <template v-else-if="isWalkin">
      <NAlert type="info" :show-icon="false" style="margin-bottom:10px;border-radius:10px">
        <div style="font-size:12px;line-height:1.7">
          你是散客：可以<b>凭签到码签到</b>，也可以<b>找接受拼场的队伍申请加入</b>，拼场成功照明费按人均分摊。
        </div>
      </NAlert>

      <div class="section-title">签到码快速签到</div>
      <div class="walkin-code">
        <NInput v-model:value="codeForm.code" placeholder="输入队长给的 6 位签到码" maxlength="6"
          style="flex:1" :input-props="{ inputmode: 'numeric' }" />
        <NButton type="primary" round @click="doCodeCheckIn">签到</NButton>
      </div>

      <div class="section-title">找拼场（{{ mergeable.length }} 场可申请）</div>
      <NEmpty v-if="mergeable.length === 0" description="当前没有可拼的队伍，可去现场排队候补（R-FAIR-2）" />

      <!-- 全场人数不足：候补等待 / 超时待释放 / 投诉入口（R-MERGE-2） -->
      <template v-for="b in myWaitingUnderfill" :key="'wait-' + b.id">
        <div class="wait-box">
          <div class="wt-top">
            <b>⏳ 正在候补：{{ b.teamName }}（全场 {{ b.halves.join('+') }}）</b>
            <NTag size="tiny" type="warning">仅 {{ checkedInCount(b) }} 人到场</NTag>
          </div>
          <div class="wt-row">
            {{ courtName(b.courtId) }} · {{ b.start }}–{{ b.end }} · 已提交拼场申请，等待队长选择
          </div>
          <div class="wt-row" v-if="b.underfill?.stage === 'prompted'">
            队长须在 <b>{{ b.underfill.decideDeadline }}</b> 前选择拼场 / 降半场 / 补缴；
            <template v-if="underfillView(b, state.mergeRequests, nowStr)!.keepRemaining <= 0">
              <span style="color:#d03050;font-weight:700">已超保留时间</span>，可请管理员释放空闲半场
            </template>
            <template v-else>
              超时未选管理员将释放空闲半场给你所在的候补组
            </template>
            <RuleLink id="R-MERGE-2" />
          </div>
          <div class="wt-actions">
            <NButton size="tiny" round type="warning" ghost @click="complaintTarget = b">📣 对处置有异议/投诉</NButton>
          </div>
        </div>
      </template>

      <!-- 已获管理员现场分配的释放半场 -->
      <template v-for="wb in myAllocations" :key="'alloc-' + wb.id">
        <BookingCard :booking="wb">
          <template #actions>
            <NButton v-if="wb.underfill?.stage === 'released' && !wb.underfill.confirmedByWalker"
              size="small" type="primary" round @click="doConfirmWalker(wb)">
              🧭 确认中线边界/照明分摊
            </NButton>
            <NTag v-else-if="boundaryConfirmed(wb)" size="small" type="success" round>双方边界已确认</NTag>
            <NButton size="small" round type="warning" ghost @click="complaintTarget = wb">📣 投诉/异议</NButton>
            <NPopconfirm @positive-click="doEnd(wb)">
              <template #trigger><NButton size="small" round type="error" ghost>🔚 结束并关灯结算</NButton></template>
              结束半场使用并按实际时长结算照明费
            </NPopconfirm>
          </template>
        </BookingCard>
      </template>

      <div v-for="b in mergeable" :key="b.id" class="merge-card">
        <div class="mc-top">
          <b>{{ b.teamName }}</b>
          <NTag size="tiny" :type="b.status === 'ongoing' ? 'success' : 'info'">
            {{ b.status === 'ongoing' ? '已开场' : `${b.start} 开场` }}
          </NTag>
        </div>
        <div class="mc-row">📍 {{ courtName(b.courtId) }} · {{ b.scope === 'full' ? '全场' : '半场' }} {{ b.halves.join('+') }} · {{ b.start }}–{{ b.end }}</div>
        <div class="mc-row">
          👥 已报名 {{ b.members.length }}/{{ b.scope === 'full' ? 14 : 8 }} 人 ·
          已签到 {{ checkedInCount(b) }} 人
          <template v-if="b.fixedTeam"> · <NTag size="tiny" type="info">固定球队</NTag></template>
        </div>
        <div class="mc-row">💡 拼场照明 8 折，按签到人数人均分摊 <RuleLink id="R-BOOK-2" /></div>
        <div class="mc-actions">
          <NButton size="small" type="primary" round
            :disabled="myApplications.some(r => r.bookingId === b.id && r.status === 'pending')"
            @click="applyTarget = b">
            {{ myApplications.some(r => r.bookingId === b.id && r.status === 'pending') ? '申请待队长处理' : '申请加入拼场' }}
          </NButton>
          <template v-for="r in myApplications.filter(x => x.bookingId === b.id)" :key="r.id">
            <NTag v-if="r.status === 'accepted'" size="small" type="success" round>已接受，凭码 {{ b.checkInCode }} 签到</NTag>
            <NTag v-else-if="r.status === 'rejected'" size="small" :type="r.unreasonable ? 'error' : 'default'" round>
              {{ r.unreasonable ? '被拒（队长已被计资源占用费）' : '被拒（对方有正当理由）' }}
            </NTag>
          </template>
        </div>
      </div>
    </template>

    <!-- 管理员 / 社区工作人员 -->
    <template v-else>
      <NEmpty description="管理员与社区工作人员请使用「现场看板」和「后台处置」标签页" />
    </template>

    <!-- 邀请队员 / 签到管理抽屉 -->
    <BottomSheet :show="!!inviteTarget" :title="inviteTarget ? `${inviteTarget.teamName} · 队员与签到（签到码 ${inviteTarget.checkInCode}）` : ''"
      @update:show="v => !v && (inviteTarget = null)">
      <div v-if="inviteTarget" class="invite-box">
        <div class="member-line" v-for="m in inviteTarget.members" :key="m.id">
          <span>
            <NTag v-if="m.isCaptain" size="tiny" type="info">队长</NTag>
            <NTag v-else-if="m.minor" size="tiny" type="warning">未成年</NTag>
            {{ m.name }}
            <span style="color:#999;font-size:12px;margin-left:4px">{{ m.phone }}</span>
          </span>
          <NButton size="tiny" round :type="m.checkedIn ? 'success' : 'default'"
            @click="toggleCheckIn(inviteTarget!.id, m.id)">
            {{ m.checkedIn ? `✅ 已签到 ${m.checkInAt}` : '签到' }}
          </NButton>
        </div>
        <NDivider />
        <NForm label-placement="top" size="small">
          <NFormItem label="邀请新队员（发送签到邀请）">
            <NSpace align="center" :wrap="false" style="width:100%">
              <NInput v-model:value="inviteForm.name" placeholder="队员姓名" style="flex:1" />
              <NInput v-model:value="inviteForm.phone" placeholder="手机号（选填）" style="flex:1" />
            </NSpace>
          </NFormItem>
          <NCheckbox v-model:checked="inviteForm.minor">该队员为未成年人（夜场须监护人陪同，R-MINOR-1）</NCheckbox>
          <NButton type="primary" block round style="margin-top:8px" @click="submitInvite">发送邀请</NButton>
        </NForm>
      </div>
    </BottomSheet>

    <!-- 拒绝拼场理由抽屉 -->
    <BottomSheet :show="!!rejectTarget" title="拒绝拼场 · 填写理由" @update:show="v => !v && (rejectTarget = null)">
      <NAlert v-if="rejectHint" :type="rejectHint.unreasonable ? 'error' : 'warning'" style="margin-bottom:10px">
        {{ rejectHint.hint }}
      </NAlert>
      <NInput v-model:value="rejectReason" type="textarea" :rows="3"
        placeholder="请填写正当理由（如：未成年人无监护人夜场、人数超额等）" />
      <NButton type="warning" block round style="margin-top:10px" :disabled="!rejectReason.trim()"
        @click="submitReject(false)">
        以正当理由拒绝（不收费）
      </NButton>
      <NPopconfirm placement="top" @positive-click="submitReject(true)">
        <template #trigger>
          <NButton size="tiny" quaternary type="error" block style="margin-top:8px">
            坚持无理由拒绝（收 20 元资源占用费、信用 -5）
          </NButton>
        </template>
        该申请可把队伍补至合理人数。确认无正当理由拒绝？将依据 R-MERGE-1 收取 20 元并扣信用 5 分。
      </NPopconfirm>
    </BottomSheet>

    <!-- 散客申请拼场抽屉 -->
    <BottomSheet :show="!!applyTarget" :title="applyTarget ? `申请加入 ${applyTarget.teamName}` : ''"
      @update:show="v => !v && (applyTarget = null)">      <NForm v-if="applyTarget" label-placement="top" size="small">
        <NFormItem label="称呼">
          <NInput v-model:value="applyForm.name" />
        </NFormItem>
        <NFormItem label="手机号（仅队长可见）">
          <NInput v-model:value="applyForm.phone" />
        </NFormItem>
        <NFormItem label="人数">
          <NInputNumber v-model:value="applyForm.people" :min="1" :max="6" />
        </NFormItem>
        <NFormItem label="留言">
          <NInput v-model:value="applyForm.message" type="textarea" :rows="2"
            placeholder="介绍一下水平/是否带球，更容易通过哦" />
        </NFormItem>
        <NCheckbox v-model:checked="applyForm.minor">同行含未成年人（夜场须监护人陪同）</NCheckbox>
        <NButton type="primary" block round style="margin-top:10px" @click="submitApply">发送申请（队长 10 分钟内处理）</NButton>
      </NForm>
    </BottomSheet>

    <!-- 散客投诉/异议抽屉（随释放状态同步的投诉入口，R-FAIR-3） -->
    <BottomSheet :show="!!complaintTarget" title="对处置有异议 · 提交投诉"
      @update:show="v => !v && (complaintTarget = null)">
      <NAlert type="warning" style="margin-bottom:10px">
        候补散客可对全场人数不足的处置（队长拒绝拼场、释放结果、边界划分）提出异议；投诉进入同一工单，社区工作人员 24 小时内书面答复（R-FAIR-3 / R-MERGE-2）。
      </NAlert>
      <NInput v-model:value="complaintText" type="textarea" :rows="4"
        placeholder="请描述异议，如：队长超保留时间仍占着空半场、边界划分影响我们投篮、照明分摊不合理等" />
      <NButton type="warning" block round style="margin-top:10px" @click="submitComplaint">提交投诉并查看工单</NButton>
    </BottomSheet>
  </div>
</template>

<style scoped>
.section-title { font-size:13px; font-weight:700; color:#555; margin:12px 2px 8px; display:flex; align-items:center; }
.merge-req { background:#fff; border:1px solid #ffe7ba; border-radius:12px; padding:10px 12px; margin-bottom:10px; }
.mr-head { display:flex; justify-content:space-between; align-items:center; }
.mr-team { font-size:12px; color:#666; margin:4px 0; }
.mr-msg { font-size:13px; background:#f7f9fc; border-radius:8px; padding:6px 8px; }
.mr-minor { font-size:12px; color:#d03050; margin-top:4px; }
.mr-actions { display:flex; gap:8px; margin-top:8px; }
.walkin-code { display:flex; gap:8px; margin-bottom:10px; }
.merge-card { background:#fff; border-radius:12px; padding:10px 12px; margin-bottom:10px; box-shadow:0 1px 4px rgba(0,0,0,.06); }
.mc-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
.mc-row { font-size:12px; color:#555; line-height:1.9; }
.mc-actions { display:flex; gap:8px; align-items:center; margin-top:6px; flex-wrap:wrap; }
.invite-box { padding-bottom:10px; }
.member-line { display:flex; justify-content:space-between; align-items:center; padding:8px 2px; border-bottom:1px solid #f2f2f2; font-size:13px; }
.uf-choices { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
.wait-box { background:#fff; border:1px solid #ffe7ba; border-radius:12px; padding:10px 12px; margin-bottom:10px; }
.wt-top { display:flex; justify-content:space-between; align-items:center; gap:6px; font-size:13px; }
.wt-row { font-size:12px; color:#666; line-height:1.8; margin-top:3px; }
.wt-actions { margin-top:6px; }
</style>
