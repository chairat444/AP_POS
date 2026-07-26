<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import type { CartSnapshot } from "@ap-pos/shared";

const cart = ref<CartSnapshot>({
  lines: [],
  itemCount: 0,
  subtotal: 0,
  discount: 0,
  total: 0,
  change: 0,
  memberName: "ลูกค้าทั่วไป",
});

let unsubscribe: (() => void) | undefined;

onMounted(() => {
  unsubscribe = window.apPos?.onCartUpdate((snapshot) => {
    cart.value = snapshot;
  });
});

onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div class="customer-screen">
    <section class="promo">
      <div class="promo-brand">เอพี หมูสด</div>
      <p class="promo-hours">เปิด 09:00 – 20:00</p>
      <div class="promo-card">
        <h2>โปรโมทสินค้า</h2>
        <p>น้ำจิ้มซีฟู้ดสูตรบ้าน — อร่อยถึงเครื่อง</p>
      </div>
      <div class="promo-card secondary">
        <h2>ครัวบ้านคุณ</h2>
        <p>น้ำจิ้มชาบู / หมูกระทะ</p>
      </div>
    </section>

    <section class="ticket">
      <header class="change-banner" :class="{ active: cart.change > 0 }">
        <span>{{ cart.change > 0 ? "ทอนบิลล่าสุด" : "เงินทอน" }}</span>
        <strong>{{ cart.change.toFixed(2) }}</strong>
      </header>
      <div class="summary-bar">
        <div>
          <span>ยอดรวมก่อนหักส่วนลด</span>
          <strong>{{ cart.subtotal.toFixed(2) }}</strong>
        </div>
        <div>
          <span>ส่วนลด</span>
          <strong>{{ cart.discount.toFixed(2) }}</strong>
        </div>
      </div>
      <div class="member">สมาชิก: {{ cart.memberName ?? "-" }}</div>
      <table>
        <thead>
          <tr>
            <th>ลำดับ</th>
            <th>ชื่อสินค้า</th>
            <th>จำนวน</th>
            <th>ราคา</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, i) in cart.lines" :key="line.id">
            <td>{{ i + 1 }}</td>
            <td>{{ line.name }}</td>
            <td class="num">{{ line.qty }}</td>
            <td class="num">{{ line.lineTotal.toFixed(2) }}</td>
          </tr>
        </tbody>
      </table>
      <footer class="total-footer">
        รวมทั้งสิ้น
        <strong>{{ cart.total.toFixed(2) }}</strong>
      </footer>
    </section>
  </div>
</template>
