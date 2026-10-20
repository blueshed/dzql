export {};

const form = document.getElementById("form") as HTMLFormElement;
const input = document.getElementById("name") as HTMLInputElement;
const submit = document.getElementById("submit") as HTMLButtonElement;
const greeting = document.getElementById("greeting") as HTMLParagraphElement;

input.addEventListener("input", () => {
  submit.disabled = input.value.trim() === "";
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  greeting.textContent = `Hello, ${input.value.trim()}`;
});
