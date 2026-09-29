// Helper Function: แปลงฟอร์แมตตัวเลขใส่จุลภาค
function formatCurrency(amount) {
    return new Intl.NumberFormat('th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount || 0);
}

// Helper Function: Format วันที่ไทย
function formatThaiDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Helper Function: ตรวจสอบความถูกต้องของเลขหวย
function validateLotteryNumber(number, type) {
    const digitsOnly = /^\d+$/;
    if (!digitsOnly.test(number)) return false;

    if (type === '3top' || type === '3tod') return number.length === 3;
    if (type === '2top' || type === '2bottom') return number.length === 2;
    if (type === 'run') return number.length === 1;
    return true;
}