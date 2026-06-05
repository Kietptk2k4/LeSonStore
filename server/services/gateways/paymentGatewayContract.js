/**
 * @typedef {object} PaymentGateway
 * @property {(params: {
 *   method?: string,
 *   amount: number,
 *   txnRef: string,
 *   orderDesc: string,
 *   ipAddr: string
 * }) => Promise<string>} createPaymentUrl
 * @property {(query: object) => {
 *   isSuccess: boolean,
 *   vnp_Params: object
 * }} verifyCallback
 */

/** JSDoc contract only — implementations: vnpayGateway.js, (future) momoGateway.js */
module.exports = {};
