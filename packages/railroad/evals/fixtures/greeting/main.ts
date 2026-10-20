const form = document.getElementById("form") as HTMLFormElement;
const name = document.getElementById("name") as HTMLInputElement;
const submit = document.getElementById("submit") as HTMLButtonElement;
const greeting = document.getElementById("greeting") as HTMLParagraphElement;

name.addEventListener("input", () => {
  submit.disabled = name.value.trim() === "";
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  greeting.textContent = `Hello, ${name.value.trim()}`;
});
