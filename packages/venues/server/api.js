export async function goodbye(userId, params = {}) {
  const { name = "World" } = params;

  return {
    message: `Goodbye, ${name}!`,
    from: "Bun",
    user_id: userId,
  };
}
